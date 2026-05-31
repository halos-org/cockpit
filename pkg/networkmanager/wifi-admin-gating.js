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
 * Admin-gating primitives for the HaLOS-owned WiFi surface.
 *
 * Controls that ultimately invoke `superuser: "require"` spawns or Polkit-
 * restricted DBus calls must be visibly disabled in Cockpit's Limited Access
 * mode so the user does not click into a silent failure.
 *
 * Cross-module convention is documented in
 * docs/solutions/best-practices/2026-05-28-cockpit-module-admin-gating-and-error-surfacing.md
 * in the halos workspace; the pilot lives in cockpit-container-apps. UI
 * primitives that depend on PatternFly live in
 * `./wifi-admin-gated-button.jsx` so this module stays lightweight enough
 * to be exercised by the QUnit suite.
 */

import cockpit from "cockpit";
import { useEffect, useState } from "react";

export const ADMIN_REQUIRED_TOOLTIP = "Administrative access required";

// Treat the loading window (`allowed === null`) and a missing permission
// handle as gated. The contract is tested in test-wifi-admin-gating.js.
export function isAdminRequired(permission) {
    if (!permission) return true;
    return permission.allowed !== true;
}

// Subscribe to `cockpit.permission({ admin: true })` once per mount and
// mirror `allowed` into React state so the UI re-renders on transitions.
//
// Outside a Cockpit page (e.g. unit-test harness without a cockpit global)
// the hook resolves to `allowed: true` so it does not gate development.
export function useAdminPermission() {
    const [allowed, setAllowed] = useState(null);

    useEffect(() => {
        if (!cockpit || typeof cockpit.permission !== "function") {
            setAllowed(true);
            return undefined;
        }

        const permission = cockpit.permission({ admin: true });
        const sync = () => setAllowed(permission.allowed);
        sync();
        permission.addEventListener("changed", sync);

        return () => {
            permission.removeEventListener("changed", sync);
            if (typeof permission.close === "function")
                permission.close();
        };
    }, []);

    return { allowed };
}
