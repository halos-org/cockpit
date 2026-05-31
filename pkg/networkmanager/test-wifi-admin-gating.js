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
 *
 * Per pilot decisions (cockpit-container-apps#80) and audit
 * (halos-org/halos#121): treat `cockpit.permission({admin:true})`
 * `allowed === null` (subscription unresolved) as admin-required so the
 * loading window is gated, not just the resolved-denied state.
 */

import QUnit from "qunit-tests";
import { isAdminRequired, ADMIN_REQUIRED_TOOLTIP } from "./wifi-admin-gating";

QUnit.module("isAdminRequired");

QUnit.test("gates while the permission subscription is unresolved (allowed === null)", function(assert) {
    assert.strictEqual(isAdminRequired({ allowed: null }), true);
});

QUnit.test("gates when admin permission is denied (allowed === false)", function(assert) {
    assert.strictEqual(isAdminRequired({ allowed: false }), true);
});

QUnit.test("does not gate when admin permission is granted (allowed === true)", function(assert) {
    assert.strictEqual(isAdminRequired({ allowed: true }), false);
});

QUnit.test("gates when the permission handle itself is null (no subscription)", function(assert) {
    assert.strictEqual(isAdminRequired(null), true);
});

QUnit.test("gates when the permission handle is undefined", function(assert) {
    assert.strictEqual(isAdminRequired(undefined), true);
});

QUnit.module("ADMIN_REQUIRED_TOOLTIP");

QUnit.test("exposes the canonical cross-module tooltip text", function(assert) {
    // Matches the AdminGatedButton convention documented in
    // docs/solutions/best-practices/2026-05-28-cockpit-module-admin-gating-and-error-surfacing.md
    assert.strictEqual(ADMIN_REQUIRED_TOOLTIP, "Administrative access required");
});

QUnit.start();
