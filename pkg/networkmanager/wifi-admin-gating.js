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

// Source-string anchor for translators. The actual `_("...")` call lives at
// the call site in `wifi-admin-gated-button.jsx` so xgettext can extract it.
// The QUnit suite pins this constant to keep cross-module copies aligned.
export const ADMIN_REQUIRED_TOOLTIP = "Administrative access required";

// Treat the loading window (`allowed === null`) as gated alongside the
// resolved-denied state. Cockpit's `Permission.allowed` is `null` until the
// initial DBus check resolves; if we let null fall through, controls would
// flicker enabled during page load. Contract pinned in test-wifi-admin-gating.js.
export function isAdminRequired(allowed) {
    return allowed !== true;
}

// Pure subscription helper. Takes cockpit (so the QUnit suite can inject a
// stub) and an onChange callback, and returns a cleanup function. Mirrors
// the pattern used by upstream `pkg/lib/superuser.js:117-122`.
//
// When cockpit is unavailable (test harness, dev environment without a
// Cockpit session) the helper resolves to `allowed: true` so it does not
// gate development.
export function subscribeAdminPermission(cockpitObj, onChange) {
    if (!cockpitObj || typeof cockpitObj.permission !== "function") {
        onChange(true);
        return () => {};
    }

    const permission = cockpitObj.permission({ admin: true });
    const sync = () => onChange(permission.allowed);
    sync();
    permission.addEventListener("changed", sync);

    return () => {
        permission.removeEventListener("changed", sync);
        if (typeof permission.close === "function")
            permission.close();
    };
}

// React hook wrapper around subscribeAdminPermission. The hook is a thin
// shim; all behavioral logic lives in the pure helper above so it can be
// exercised without a React render harness.
//
// Note: upstream `Permission.maybe_reload` (pkg/lib/cockpit.js) reloads the
// whole page when admin status changes after initial resolution, so the
// `changed` listener really only matters for the initial null → resolved
// transition — subsequent transitions never reach React.
export function useAdminPermission() {
    const [allowed, setAllowed] = useState(null);

    useEffect(() => subscribeAdminPermission(cockpit, setAllowed), []);

    return { allowed };
}
