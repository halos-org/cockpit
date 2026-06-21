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
 * Render tests for the AP integration-mode UI (halos-org/cockpit#85).
 *
 * The repo's first react-dom render test. QUnit here runs in a real Chromium
 * (test/pytest/test_browser.py over qunit/**), so react-dom@18's createRoot +
 * React.act work against a real DOM with no jsdom/testing-library dependency.
 * These assert *rendered* behavior (button presence, Alert variant, text) that
 * the pure-function suites can't reach.
 *
 * Foundation slice: proves the harness (render + ModelContext/Dialogs context +
 * cockpit singleton mock + breadcrumb-stub-driven R19) on the highest-value
 * scenarios. The remaining scenarios from the plan extend this same harness.
 */

import QUnit from "qunit-tests";
import React from "react";
import { createRoot } from "react-dom/client";
import cockpit from "cockpit";

import { DialogsContext } from "dialogs.jsx";
import { WiFiAPConfig } from "./wifi.jsx";
import { ModelContext } from "./model-context";
import { AP_SWITCH_PATHS } from "./ap-switch";

// --- cockpit singleton mock (save/restore so nothing bleeds into other suites) ---
const realFile = cockpit.file;
const realSpawn = cockpit.spawn;
const realPermission = cockpit.permission;

// Drives the R19 breadcrumb; mutate before render, the watch fires it synchronously.
let breadcrumbContent = null;

function installCockpitStubs() {
    cockpit.file = (path) => {
        if (path === AP_SWITCH_PATHS.breadcrumb) {
            return {
                watch(cb) { cb(breadcrumbContent); return { remove() {} } },
                close() {},
                replace(v) { breadcrumbContent = v; return Promise.resolve() },
            };
        }
        // Any other path (e.g. the dnsmasq leases file) -> empty content.
        return {
            watch(cb) { cb(null); return { remove() {} } },
            close() {},
            replace() { return Promise.resolve() },
        };
    };
    cockpit.spawn = () => Promise.resolve("");
    cockpit.permission = () => ({ allowed: true, addEventListener() {}, removeEventListener() {}, close() {} });
}

function restoreCockpitStubs() {
    cockpit.file = realFile;
    cockpit.spawn = realSpawn;
    cockpit.permission = realPermission;
}

const modelStub = {};
const dialogsStub = { show() {}, close() {} };

let mounted = null;
function renderCard(props) {
    const container = document.createElement("div");
    document.getElementById("qunit-fixture").appendChild(container);
    const root = createRoot(container);
    React.act(() => {
        root.render(
            React.createElement(ModelContext.Provider, { value: modelStub },
                                React.createElement(DialogsContext.Provider, { value: dialogsStub },
                                                    React.createElement(WiFiAPConfig, props))));
    });
    mounted = { container, root };
    return container;
}

// Connection fixtures mirroring pkg/networkmanager/test-wifi-hooks.js classifier inputs.
function isolatedConnection() {
    return {
        Settings: {
            connection: { type: "802-11-wireless", interface_name: "wlan0ap", uuid: "ap-uuid" },
            wifi: { mode: "ap", ssid: "Halos" },
            wifi_security: { key_mgmt: "wpa-psk" },
            ipv4: { method: "shared" },
        }
    };
}
function customConnection() {
    // method=manual on a no-master AP classifies as Custom (read-only).
    const c = isolatedConnection();
    c.Settings.ipv4 = { method: "manual", address_data: [{ address: "192.168.5.1", prefix: 24 }] };
    return c;
}

const baseProps = (connection) => ({
    dev: { Interface: "wlan0ap" },
    connection,
    activeConnection: null,
    apActive: true,
    isAdminGated: false,
});

QUnit.module("WiFiAPConfig render", {
    beforeEach: installCockpitStubs,
    afterEach: () => {
        if (mounted) React.act(() => mounted.root.unmount());
        mounted = null;
        breadcrumbContent = null;
        restoreCockpitStubs();
    },
});

QUnit.test("managed (Isolated) AP renders Configure and the Isolated IP range, no read-only notice", function(assert) {
    breadcrumbContent = null;
    const el = renderCard(baseProps(isolatedConnection()));
    const buttons = [...el.querySelectorAll("button")].map(b => b.textContent);
    assert.ok(buttons.includes("Configure"), "Configure button present for a managed AP");
    assert.ok(buttons.includes("Disable"), "Disable button present");
    assert.ok(el.textContent.includes("10.42.0.1/24"), "Isolated IP range rendered");
    assert.notOk(el.textContent.includes("configured outside HaLOS"), "no read-only notice for a managed AP");
});

QUnit.test("Custom AP is read-only: no Configure button, read-only notice shown", function(assert) {
    breadcrumbContent = null;
    const el = renderCard(baseProps(customConnection()));
    const buttons = [...el.querySelectorAll("button")].map(b => b.textContent);
    assert.notOk(buttons.includes("Configure"), "Configure suppressed for a Custom AP");
    assert.ok(buttons.includes("Disable"), "Disable still present");
    assert.ok(el.textContent.includes("configured outside HaLOS"), "read-only notice rendered");
    assert.notOk(el.textContent.includes("10.42.0.1/24"), "never the 10.42 default for Custom");
});

QUnit.test("R19 success outcome is NOT bannered (suppression regression guard)", function(assert) {
    breadcrumbContent = "verdict=healthy\nreason=bridged-confirmed gateway=reachable\n";
    const el = renderCard(baseProps(isolatedConnection()));
    assert.strictEqual(el.querySelectorAll(".pf-v6-c-alert").length, 0,
                       "a success verdict renders no outcome Alert");
});

QUnit.test("R19 auto-revert outcome renders a dismissible warning Alert", function(assert) {
    breadcrumbContent = "verdict=reverted\nreason=gateway-mismatch\n";
    const el = renderCard(baseProps(isolatedConnection()));
    const alert = el.querySelector(".pf-v6-c-alert");
    assert.ok(alert, "an auto-revert renders an outcome Alert");
    assert.ok(alert.className.includes("pf-m-warning"), "variant is warning");
    assert.ok(alert.querySelector("button"), "Alert has a dismiss button");
});

QUnit.start();
