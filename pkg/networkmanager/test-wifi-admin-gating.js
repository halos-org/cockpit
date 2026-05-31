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
 * Unit tests for WiFi admin-gating helpers.
 *
 * Pins down the contract used to disable WiFi controls in Cockpit's
 * Limited Access mode, where `superuser: "require"` spawns and
 * Polkit-restricted DBus calls would otherwise fail silently after the
 * user clicks a control.
 */

import QUnit from "qunit-tests";
import {
    isAdminRequired,
    subscribeAdminPermission,
    ADMIN_REQUIRED_TOOLTIP,
} from "./wifi-admin-gating";

// ============================================================================
// isAdminRequired predicate
// ============================================================================
//
// Pilot decision (cockpit-container-apps#80): treat the loading window
// (allowed === null) as gated so controls don't briefly flash enabled
// during initial page load.

QUnit.module("isAdminRequired");

QUnit.test("gates while the permission subscription is unresolved (null)", function(assert) {
    assert.strictEqual(isAdminRequired(null), true);
});

QUnit.test("gates when admin permission is denied (false)", function(assert) {
    assert.strictEqual(isAdminRequired(false), true);
});

QUnit.test("does not gate when admin permission is granted (true)", function(assert) {
    assert.strictEqual(isAdminRequired(true), false);
});

QUnit.test("gates when no permission value has been threaded through (undefined)", function(assert) {
    assert.strictEqual(isAdminRequired(undefined), true);
});

// ============================================================================
// subscribeAdminPermission
// ============================================================================

function makeFakePermission(initialAllowed) {
    const listeners = [];
    return {
        allowed: initialAllowed,
        addEventListener(event, fn) {
            if (event === "changed") listeners.push(fn);
        },
        removeEventListener(event, fn) {
            if (event !== "changed") return;
            const idx = listeners.indexOf(fn);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        // Test-only: fire the change event after mutating .allowed.
        _fire() { for (const fn of listeners) fn(); },
        _listenerCount() { return listeners.length },
        close() { this._closed = true },
    };
}

QUnit.module("subscribeAdminPermission");

QUnit.test("resolves to true when cockpit is unavailable (dev/test harness)", function(assert) {
    const calls = [];
    const cleanup = subscribeAdminPermission(null, value => calls.push(value));
    assert.deepEqual(calls, [true]);
    assert.strictEqual(typeof cleanup, "function");
    cleanup(); // should be a no-op, must not throw
});

QUnit.test("resolves to true when cockpit lacks a permission() function", function(assert) {
    const calls = [];
    subscribeAdminPermission({}, value => calls.push(value));
    assert.deepEqual(calls, [true]);
});

QUnit.test("emits the initial permission.allowed value synchronously", function(assert) {
    const permission = makeFakePermission(false);
    const cockpitStub = { permission: () => permission };
    const calls = [];
    subscribeAdminPermission(cockpitStub, value => calls.push(value));
    assert.deepEqual(calls, [false]);
});

QUnit.test("emits subsequent transitions via the 'changed' event", function(assert) {
    const permission = makeFakePermission(null);
    const cockpitStub = { permission: () => permission };
    const calls = [];
    subscribeAdminPermission(cockpitStub, value => calls.push(value));
    permission.allowed = true;
    permission._fire();
    permission.allowed = false;
    permission._fire();
    assert.deepEqual(calls, [null, true, false]);
});

QUnit.test("cleanup removes the listener so post-unmount events are ignored", function(assert) {
    const permission = makeFakePermission(true);
    const cockpitStub = { permission: () => permission };
    const calls = [];
    const cleanup = subscribeAdminPermission(cockpitStub, value => calls.push(value));
    cleanup();
    assert.strictEqual(permission._listenerCount(), 0);
    permission.allowed = false;
    permission._fire();
    assert.deepEqual(calls, [true]);
});

QUnit.test("cleanup calls permission.close() when available", function(assert) {
    const permission = makeFakePermission(true);
    const cockpitStub = { permission: () => permission };
    const cleanup = subscribeAdminPermission(cockpitStub, () => {});
    cleanup();
    assert.strictEqual(permission._closed, true);
});

// ============================================================================
// ADMIN_REQUIRED_TOOLTIP
// ============================================================================

QUnit.module("ADMIN_REQUIRED_TOOLTIP");

QUnit.test("matches the cross-module canonical tooltip text", function(assert) {
    // Pins the source string so a rename here forces an audit of the JSX
    // call site (wifi-admin-gated-button.jsx) which uses the same literal
    // wrapped in `_("...")` for xgettext extraction.
    assert.strictEqual(ADMIN_REQUIRED_TOOLTIP, "Administrative access required");
});

QUnit.start();
