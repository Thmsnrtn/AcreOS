/**
 * Atlas tool startup hook. Importing this module side-effects the
 * registry — every tool file registers on load. Import once at server
 * boot (next to other founder router mounts).
 *
 * NOTE: order matters for slash-alias resolution if two tools share an
 * alias. Inquiry → action → synthesis → delegation per the plan order.
 */

import "./inquiry";
import "./action";
import "./synthesis";
import "./delegation";
import "./operations";
import "./destructive";
import "./meta";

export const TOOLS_REGISTERED = true;
