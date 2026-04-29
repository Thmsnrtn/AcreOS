// URL of the copy-edit injector script. Served from the picker's static
// bundle (/__dev/picker/injectors/copy-edit.js) so it loads same-origin
// inside the production iframe and passes its strict CSP (script-src 'self').
//
// The actual injector source lives at acreos-picker/public/injectors/copy-edit.js.

export const COPY_EDIT_INJECTOR_URL = '/__dev/picker/injectors/copy-edit.js';
