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
 * Unit tests for the AP mode-switch orchestration command builders (Unit 6).
 */

import QUnit from "qunit-tests";
import {
    buildEnterBridgedScript, buildRevertCommand, buildArmDeadmanCommand,
    buildLaunchApplyCommand, mapVerdictToOutcome, parseBreadcrumb,
    AP_SWITCH_PATHS,
} from "./ap-switch";

const SAMPLE = { apUuid: "ap-uuid-1", ethMac: "DC:A6:32:00:11:22", gateway: "192.168.8.1", channel: 6 };

QUnit.module("buildEnterBridgedScript");

QUnit.test("brings the active eth0 down BEFORE br0 (cloned MAC) goes live", function(assert) {
    const s = buildEnterBridgedScript(SAMPLE);
    const ethDown = s.indexOf('connection down "$ETH_ACTIVE"');
    const br0Up = s.indexOf("nmcli connection up br0");
    assert.ok(ethDown > -1 && br0Up > -1, "both steps present");
    assert.ok(ethDown < br0Up, "eth0 down precedes br0 up (no dual-MAC)");
});

QUnit.test("clones the eth0 MAC onto br0", function(assert) {
    const s = buildEnterBridgedScript(SAMPLE);
    assert.ok(s.includes("bridge.mac-address 'DC:A6:32:00:11:22'"), "MAC clone present");
});

QUnit.test("enslaves the AP with membership only — never ipv4 in the same call", function(assert) {
    const s = buildEnterBridgedScript(SAMPLE);
    const line = s.split("\n").find(l => l.includes("connection.slave-type bridge"));
    assert.ok(line, "enslave line present");
    assert.ok(line.includes("connection.master br0"), "sets master");
    assert.notOk(line.includes("ipv4"), "no ipv4.* in the enslave call");
});

QUnit.test("sets the fixed channel, and brings the AP up LAST", function(assert) {
    const s = buildEnterBridgedScript(SAMPLE);
    const enslave = s.indexOf("connection.slave-type bridge");
    const channel = s.indexOf("802-11-wireless.channel '6'");
    const apUp = s.indexOf("nmcli connection up 'ap-uuid-1'");
    assert.ok(enslave < channel, "channel set after enslave");
    assert.ok(channel < apUp, "channel set before AP up");
    assert.strictEqual(s.trimEnd().endsWith("nmcli connection up 'ap-uuid-1'"), true, "AP con-up is the last step");
});

QUnit.test("creates are idempotent (existence-guarded)", function(assert) {
    const s = buildEnterBridgedScript(SAMPLE);
    assert.ok(s.includes("grep -qx 'br0' || nmcli connection add type bridge"), "br0 guarded");
    assert.ok(s.includes("grep -qx 'br0-eth0' || nmcli connection add type ethernet"), "br0-eth0 guarded");
});

QUnit.test("persists the expected gateway and marks the card in-flight first", function(assert) {
    const s = buildEnterBridgedScript(SAMPLE);
    const gw = s.indexOf("> '" + AP_SWITCH_PATHS.expectedGwFile + "'");
    const crumb = s.indexOf("verdict=switching");
    const firstNmcliAdd = s.indexOf("nmcli connection add");
    assert.ok(gw > -1 && crumb > -1, "gateway + switching breadcrumb written");
    assert.ok(gw < firstNmcliAdd && crumb < firstNmcliAdd, "both happen before any topology change");
});

QUnit.test("uses set -e so a partial switch stops for the watchdog to revert", function(assert) {
    assert.ok(buildEnterBridgedScript(SAMPLE).startsWith("set -e"), "set -e first");
});

QUnit.module("buildRevertCommand");

QUnit.test("switch-back invokes the shared watchdog revert", function(assert) {
    assert.deepEqual(buildRevertCommand(), [AP_SWITCH_PATHS.watchdog, "revert"]);
});

QUnit.test("disable-while-Bridged leaves the AP down via NO_AP_UP", function(assert) {
    assert.deepEqual(buildRevertCommand({ disable: true }),
                     ["env", "NO_AP_UP=1", AP_SWITCH_PATHS.watchdog, "revert"]);
});

QUnit.module("buildArmDeadmanCommand / buildLaunchApplyCommand");

QUnit.test("deadman is a detached systemd-run firing the watchdog switch verdict", function(assert) {
    const argv = buildArmDeadmanCommand({ window: 45 });
    assert.strictEqual(argv[0], "systemd-run");
    assert.ok(argv.includes("--on-active=45"), "window set");
    assert.ok(argv.includes("--collect"), "detached/collected");
    assert.deepEqual(argv.slice(-2), [AP_SWITCH_PATHS.watchdog, "switch"], "fires watchdog switch");
});

QUnit.test("apply launches detached via systemd-run bash -c", function(assert) {
    const argv = buildLaunchApplyCommand("set -e\nnmcli ...");
    assert.strictEqual(argv[0], "systemd-run");
    assert.deepEqual(argv.slice(-3, -1), ["/bin/bash", "-c"]);
    assert.strictEqual(argv[argv.length - 1], "set -e\nnmcli ...");
});

QUnit.module("mapVerdictToOutcome");

QUnit.test("maps each verdict to its R19 phase/variant", function(assert) {
    assert.deepEqual(mapVerdictToOutcome("switching"), { phase: "in-flight", variant: "info" });
    assert.deepEqual(mapVerdictToOutcome("healthy"), { phase: "success-bridged", variant: "success" });
    assert.deepEqual(mapVerdictToOutcome("recovered"), { phase: "hard-failure", variant: "danger" });
    assert.deepEqual(mapVerdictToOutcome("stranded"), { phase: "hard-failure", variant: "danger" });
    assert.deepEqual(mapVerdictToOutcome("skipped"), { phase: "idle", variant: null });
});

QUnit.test("reverted is success for an intentional switch-back, warning for an auto-revert", function(assert) {
    assert.deepEqual(mapVerdictToOutcome("reverted", "explicit-revert"),
                     { phase: "success-isolated", variant: "success" });
    assert.deepEqual(mapVerdictToOutcome("reverted", "gateway-mismatch"),
                     { phase: "auto-revert", variant: "warning" });
});

QUnit.module("parseBreadcrumb");

QUnit.test("parses key=value lines, tolerating values with '='", function(assert) {
    assert.deepEqual(
        parseBreadcrumb("verdict=reverted\nreason=gateway-mismatch\n"),
        { verdict: "reverted", reason: "gateway-mismatch" });
    assert.deepEqual(parseBreadcrumb("").verdict, undefined);
});

QUnit.start();
