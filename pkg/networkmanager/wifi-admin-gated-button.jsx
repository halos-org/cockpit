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

import cockpit from "cockpit";
import React from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { ADMIN_REQUIRED_TOOLTIP } from "./wifi-admin-gating";

const _ = cockpit.gettext;

// Button wrapper used at every WiFi control site that triggers an
// admin-required action. When gated, the underlying PatternFly Button is
// rendered with `isAriaDisabled` (which suppresses onClick via
// preventDefault) and wrapped in a Tooltip explaining why.
//
// Composes with the caller's own `isDisabled` / `isAriaDisabled` /
// `isLoading` so transient disable states (e.g. an in-flight scan) still
// work.
export const AdminGatedButton = ({
    isAdminGated,
    isAriaDisabled,
    isDisabled,
    children,
    ...rest
}) => {
    const button = (
        <Button
            {...rest}
            isAriaDisabled={isAdminGated || isAriaDisabled || isDisabled}
        >
            {children}
        </Button>
    );

    if (!isAdminGated)
        return button;

    return <Tooltip content={_(ADMIN_REQUIRED_TOOLTIP)}>{button}</Tooltip>;
};
