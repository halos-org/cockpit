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
 * AP network integration mode classification.
 *
 * Pure logic with no React/cockpit dependencies so it can be imported by both
 * the active-AP display hook (useWiFiAPInfo) and the WiFiAPConfig component, and
 * unit-tested directly. It reads the parsed NM model Settings produced by
 * interfaces.js (settings_from_nm): connection.member_type (from slave-type),
 * connection.group (from master), ipv4.method, plus the resolved .Groups /
 * .Members object graph.
 *
 * @module ap-integration-mode
 */

export const AP_INTEGRATION_MODES = {
    ISOLATED: "isolated",
    BRIDGED: "bridged",
    CUSTOM: "custom",
};

// Identity of the managed Bridged topology. Anchored on interface names (which
// the managed save path controls), not on the editable connection.id or the
// continuity-only MAC clone.
const MANAGED_BRIDGE = "br0";
const MANAGED_UPLINK = "eth0";
const MANAGED_AP_IFACE = "wlan0ap";

function memberInterfaceName(connection) {
    return connection?.Settings?.connection?.interface_name;
}

function isManagedBridgeMaster(apConnection, group) {
    // Resolved master (model graph) is the strongest signal...
    const master = apConnection?.Groups?.[0];
    if (master?.Settings?.bridge &&
        master.Settings?.connection?.interface_name === MANAGED_BRIDGE)
        return true;
    // ...but during a mid-transition the graph may not be realized yet, so fall
    // back to the persisted master reference when it names br0 directly.
    return group === MANAGED_BRIDGE;
}

/**
 * Classify the live AP connection's network integration mode.
 *
 * Decision ladder (biased to Custom on genuine ambiguity, since a false-Custom
 * is a reversible annoyance while a false-managed clobbers a hand-built config):
 *   1. not a bridge member AND ipv4.method === 'shared'                -> isolated
 *   2. bridge member of our managed br0 (exactly eth0 + wlan0ap ports) -> bridged
 *   3. anything else                                                   -> custom
 *
 * Port-set matching degrades gracefully: a *missing* managed port (the bridge is
 * still coming up) keeps the AP Bridged; only a *foreign* port forces Custom.
 *
 * @param {object} apConnection - the AP NM model Connection (with .Settings, .Groups)
 * @returns {'isolated'|'bridged'|'custom'}
 */
export function classifyApIntegrationMode(apConnection) {
    const settings = apConnection?.Settings;
    const conn = settings?.connection;
    if (!conn)
        return AP_INTEGRATION_MODES.CUSTOM;

    // Not a member of anything: Isolated only when it is the shared NAT AP.
    if (!conn.member_type && !conn.group) {
        return settings.ipv4?.method === "shared"
            ? AP_INTEGRATION_MODES.ISOLATED
            : AP_INTEGRATION_MODES.CUSTOM;
    }

    // A bridge port of our managed br0 with no foreign ports is Bridged.
    if (conn.member_type === "bridge") {
        if (!isManagedBridgeMaster(apConnection, conn.group))
            return AP_INTEGRATION_MODES.CUSTOM;

        const members = apConnection?.Groups?.[0]?.Members ?? [];
        const hasForeignPort = members.some(member => {
            const ifname = memberInterfaceName(member);
            return ifname !== MANAGED_AP_IFACE && ifname !== MANAGED_UPLINK;
        });
        return hasForeignPort ? AP_INTEGRATION_MODES.CUSTOM : AP_INTEGRATION_MODES.BRIDGED;
    }

    // Member of a non-bridge master (bond/team/vlan) is not a managed AP mode.
    return AP_INTEGRATION_MODES.CUSTOM;
}

/**
 * Whether a classified mode is one HaLOS manages (and may edit). Custom is
 * detected-only and read-only.
 *
 * @param {'isolated'|'bridged'|'custom'} mode
 * @returns {boolean}
 */
export function isManagedApMode(mode) {
    return mode === AP_INTEGRATION_MODES.ISOLATED || mode === AP_INTEGRATION_MODES.BRIDGED;
}
