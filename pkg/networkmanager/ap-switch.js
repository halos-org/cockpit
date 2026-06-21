/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2026 Hat Labs
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * AP network-integration-mode switch orchestration (Unit 6, halos-org/cockpit#79).
 *
 * Pure logic with no React/cockpit dependencies so the command sequences are
 * unit-testable. The actual execution (cockpit.spawn, detached systemd-run,
 * breadcrumb polling) lives in wifi.jsx. The forward (enter-Bridged) sequence is
 * built here; the revert is the SHARED primitive shipped device-side as
 * ap-bridge-watchdog.sh (Unit 4), so switch-back and disable-while-Bridged just
 * invoke that one script — never a second JS reimplementation.
 *
 * @module ap-switch
 */

// Device-side paths shipped by cockpit-networkmanager-halos (Unit 4).
export const AP_SWITCH_PATHS = {
    watchdog: "/usr/libexec/halos/ap-bridge-watchdog.sh",
    breadcrumb: "/run/halos/ap-bridge-watchdog.verdict",
    stateDir: "/var/lib/halos/ap-bridge",
    expectedGwFile: "/var/lib/halos/ap-bridge/expected-gateway",
};

export const MANAGED_BRIDGE = "br0";
export const MANAGED_BRIDGE_PORT = "br0-eth0";
export const MANAGED_UPLINK = "eth0";
export const MANAGED_AP_IFACE = "wlan0ap";
export const MANAGED_ETH_CON = "halos-eth0"; // fixed-id standalone DHCP eth0 profile

// Deadman / verdict windows (s). Conservative; tuned on hardware in Unit 7.
export const SWITCH_DEADMAN_WINDOW = 45;

/**
 * Build the enter-Bridged apply as a single bash script, run DETACHED (the
 * switch moves L3 off eth0 and re-associates the AP, dropping the Cockpit
 * session; the script must finish regardless). `set -e` stops on the first
 * failure so a partial switch is left for the armed watchdog to revert.
 *
 * Ordering invariants (hardware-verified recipe, halos-org/cockpit#79):
 *  - the active eth0 connection is brought DOWN before br0 (cloned MAC) goes
 *    live, so the cloned MAC is never on two interfaces at once;
 *  - the AP psk is stashed BEFORE the enslave (NM drops the in-file psk once the
 *    AP is a bridge port, so post-enslave activations re-feed it from the stash);
 *  - the AP is enslaved with NO ipv4.* in the same call (NM rejects it);
 *  - the stale Isolated 10.42 NAT is flushed once the AP is a bridge port;
 *  - the fixed channel is set before, and the AP con-up is, last.
 * Every create is existence-guarded (idempotent).
 *
 * @param {object} o
 * @param {string} o.apUuid   - the AP connection uuid (operate by uuid, never wlan0/STA)
 * @param {string} o.ethMac   - eth0 permanent MAC to clone onto br0 (lease continuity)
 * @param {string} o.gateway  - eth0's pre-switch upstream gateway (persisted for the verdict)
 * @param {number} o.channel  - fixed channel (R3)
 * @returns {string}
 */
export function buildEnterBridgedScript({ apUuid, ethMac, gateway, channel }) {
    const BR = MANAGED_BRIDGE;
    const PORT = MANAGED_BRIDGE_PORT;
    const UP = MANAGED_UPLINK;
    const AP_IFACE = MANAGED_AP_IFACE;
    const WATCHDOG = AP_SWITCH_PATHS.watchdog;
    const { breadcrumb, stateDir, expectedGwFile } = AP_SWITCH_PATHS;
    const has = name => `nmcli -t -f NAME connection show | grep -qx ${shq(name)}`;
    return [
        "set -e",
        // Persist the pre-switch gateway for the switch-mode verdict, and mark
        // the card in-flight before anything moves.
        `mkdir -p ${shq(stateDir)} $(dirname ${shq(breadcrumb)})`,
        `printf '%s\\n' ${shq(gateway)} > ${shq(expectedGwFile)}`,
        `printf 'verdict=switching\\nreason=enter-bridged\\n' > ${shq(breadcrumb)}`,
        // br0 with the cloned eth0 MAC (not yet up).
        `${has(BR)} || nmcli connection add type bridge con-name ${BR} ifname ${BR} ` +
            `ipv4.method auto ipv6.method auto bridge.stp no connection.autoconnect yes ` +
            `bridge.mac-address ${shq(ethMac)}`,
        // eth0 as a bridge port.
        `${has(PORT)} || nmcli connection add type ethernet con-name ${PORT} ifname ${UP} ` +
            `master ${BR} connection.autoconnect yes`,
        // Down the active eth0 connection BEFORE br0 goes live (no dual-MAC).
        // Query the device's connection name directly — colon-safe (nmcli -g
        // emits the raw single value, vs -f NAME,DEVICE where awk -F: would
        // mis-split a connection name containing a colon).
        `ETH_ACTIVE=$(nmcli -t -g GENERAL.CONNECTION device show ${UP})`,
        `if [ -n "$ETH_ACTIVE" ] && [ "$ETH_ACTIVE" != ${shq(PORT)} ]; then ` +
            `nmcli connection modify "$ETH_ACTIVE" connection.autoconnect no; ` +
            `nmcli connection down "$ETH_ACTIVE"; fi`,
        // Bring the bridge up (br0 holds the cloned-MAC lease).
        `nmcli connection up ${BR}`,
        `nmcli connection up ${PORT}`,
        // Stash the AP psk while it is STILL in the keyfile — NM drops the
        // in-file psk the moment the AP becomes a bridge port, so every
        // post-enslave activation (the con-up below, the watchdog revert and
        // boot-revert) sources it from the stash. `stash` fails the apply (via
        // set -e) if it cannot, so the AP is never enslaved with no psk source.
        `env AP_CON=${shq(apUuid)} ${WATCHDOG} stash`,
        // Enslave the AP — membership only, no ipv4.* in this call.
        `nmcli connection modify ${shq(apUuid)} connection.master ${BR} connection.slave-type bridge`,
        // Fixed channel (R3).
        `nmcli connection modify ${shq(apUuid)} 802-11-wireless.channel ${shq(String(channel))}`,
        // Drop the now-stale Isolated NAT (90-ap-nat won't re-add it for a bridge
        // port, but the rule installed while Isolated lingers, inert, otherwise).
        `iptables -t nat -D POSTROUTING -s 10.42.0.0/24 -j MASQUERADE 2>/dev/null || true`,
        `iptables -D FORWARD -i ${AP_IFACE} -j ACCEPT 2>/dev/null || true`,
        `iptables -D FORWARD -o ${AP_IFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true`,
        // Bring the AP up last — via the shared psk-aware activation (a post-
        // enslave con-up needs the psk re-fed; ${WATCHDOG} up does it identically
        // to the watchdog revert).
        `env AP_CON=${shq(apUuid)} ${WATCHDOG} up`,
    ].join("\n");
}

/**
 * The shared revert primitive: invoke the device-side watchdog's `revert` mode.
 * disable-while-Bridged leaves the AP down via NO_AP_UP=1.
 * @param {object} [o]
 * @param {boolean} [o.disable] - disable-while-Bridged (leave the AP down)
 * @returns {string[]} argv for cockpit.spawn
 */
export function buildRevertCommand({ disable = false } = {}) {
    const cmd = [AP_SWITCH_PATHS.watchdog, "revert"];
    return disable ? ["env", "NO_AP_UP=1", ...cmd] : cmd;
}

// Per-attempt transient unit names. Unique per switch so a rapid re-attempt
// never collides with a prior, not-yet-collected unit; the watchdog's own flock
// serializes the actual verdict/revert.
export function apSwitchUnitNames(tag) {
    return {
        deadman: `ap-bridge-switch-deadman-${tag}`,
        apply: `ap-bridge-switch-apply-${tag}`,
    };
}

/**
 * Arm the transient deadman that verifies the switch and reverts if it failed.
 * Detached + PID-1-owned so it survives the session drop the switch causes.
 * @param {object} o
 * @param {string} o.tag - unique per-attempt tag (see apSwitchUnitNames)
 * @param {number} [o.window] - seconds until the verdict fires
 * @returns {string[]} argv for cockpit.spawn
 */
export function buildArmDeadmanCommand({ tag, window = SWITCH_DEADMAN_WINDOW }) {
    return [
        "systemd-run", "--collect", `--unit=${apSwitchUnitNames(tag).deadman}`,
        `--on-active=${window}`,
        AP_SWITCH_PATHS.watchdog, "switch",
    ];
}

/**
 * Launch the enter-Bridged apply detached so it completes across the session
 * drop. The deadman (armed separately, first) is the safety net.
 * @param {string} script - from buildEnterBridgedScript
 * @param {string} tag - unique per-attempt tag (see apSwitchUnitNames)
 * @returns {string[]} argv for cockpit.spawn
 */
export function buildLaunchApplyCommand(script, tag) {
    return [
        "systemd-run", "--collect", `--unit=${apSwitchUnitNames(tag).apply}`,
        "/bin/bash", "-c", script,
    ];
}

/**
 * Map a verdict breadcrumb to an R19 UI outcome. Drives the in-flight state and
 * the success / auto-revert / hard-failure Alerts.
 *
 * `reason` disambiguates verdict=reverted: an intentional switch-back to Isolated
 * (the watchdog's `revert` mode) writes reason=explicit-revert and is a SUCCESS,
 * whereas a failed-Bridged auto-revert writes a failure reason and is a warning.
 *
 * @param {string} verdict - the breadcrumb `verdict` value
 * @param {string} [reason] - the breadcrumb `reason` value
 * @returns {{phase: string, variant: string|null}}
 */
export function mapVerdictToOutcome(verdict, reason) {
    switch (verdict) {
    case "switching":
        return { phase: "in-flight", variant: "info" };
    case "healthy":
        return { phase: "success-bridged", variant: "success" };
    case "reverted":
        return reason === "explicit-revert"
            ? { phase: "success-isolated", variant: "success" }
            : { phase: "auto-revert", variant: "warning" };
    case "recovered":
        return { phase: "hard-failure", variant: "danger" };
    case "stranded":
        // The automatic recovery itself failed: NOT guaranteed at 10.42.0.1, so
        // this gets its own, more defensive copy than "recovered".
        return { phase: "stranded", variant: "danger" };
    default:
        return { phase: "idle", variant: null };
    }
}

/** Parse a `key=value\n…` breadcrumb into an object. */
export function parseBreadcrumb(text) {
    const out = {};
    for (const line of String(text || "").split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
    }
    return out;
}

// Minimal single-quote shell escaping for values interpolated into the script.
function shq(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}
