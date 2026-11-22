/**
 * The small fixed tables of docs/tools/specs/html-to-jsx.md §5: React's events, flags, numeric properties and unitless
 * style properties (from `react-dom` 19.3.1, the version the workspace has — a test of the ui package checks each list
 * against that package's source), and the HTML lists of void and block elements. The attribute names (306 pairs) are a
 * data file of their own, loaded on first need (names.ts).
 */

const capitalised = (name: string): string => name[0]!.toUpperCase() + name.slice(1);

/**
 * React's events as `on` + their name: `simpleEventPluginEvents` and the events its plugins register (change, select,
 * enter/leave, before input, composition, animation, transition). Keyed by the HTML attribute's name in lower case.
 */
export const REACT_EVENTS: readonly string[] = (
  'abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter ' +
  'dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange ' +
  'fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart ' +
  'lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel ' +
  'pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled ' +
  'submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll scrollEnd toggle touchMove waiting ' +
  'wheel change select focus blur mouseEnter mouseLeave pointerEnter pointerLeave beforeInput compositionStart ' +
  'compositionUpdate compositionEnd animationStart animationEnd animationIteration transitionStart transitionEnd ' +
  'transitionRun transitionCancel'
).split(' ');

/** `onclick` → `onClick`; the three React names that differ from the DOM event's. */
export const EVENT_PROPS: ReadonlyMap<string, string> = new Map([
  ...REACT_EVENTS.map(e => [`on${e.toLowerCase()}`, `on${capitalised(e)}`] as const),
  ['ondblclick', 'onDoubleClick'],
  ['onfocusin', 'onFocus'],
  ['onfocusout', 'onBlur'],
]);

/** React's flag properties: written as the bare name whatever the attribute's value (presence is what HTML reads). */
export const BOOLEAN_PROPS: ReadonlySet<string> = new Set(
  (
    'allowFullScreen async autoFocus autoPlay checked controls credentialless default defaultChecked defer disabled ' +
    'disablePictureInPicture disableRemotePlayback formNoValidate hidden inert itemScope loop multiple muted noModule ' +
    'noValidate open playsInline readOnly required reversed scoped seamless selected'
  ).split(' '),
);

/** Properties typed `number` in `@types/react`: a number in the attribute becomes `{n}`. */
export const NUMERIC_PROPS: ReadonlySet<string> = new Set(
  'border cols colSpan high low marginHeight marginWidth maxLength minLength optimum rows rowSpan size span start tabIndex'.split(
    ' ',
  ),
);

/**
 * React's `unitlessNumbers`: style properties where a number means itself. Elsewhere React appends `px` to a number,
 * so `width: 10` (no unit: CSS ignores it) stays the string '10' and means the same (only 0 is a number everywhere).
 */
export const UNITLESS_STYLES: ReadonlySet<string> = new Set(
  (
    'animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup ' +
    'boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow ' +
    'gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp ' +
    'lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity ' +
    'strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount ' +
    'MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative ' +
    'msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan ' +
    'WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount ' +
    'WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp'
  ).split(' '),
);

/** Elements that never have children in HTML (always self-closing). */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set(
  'area base br col embed hr img input link meta source track wbr'.split(' '),
);

/** Block elements for the rules of whitespace and layout (§5 «Текст и пробелы», п. 5). */
export const BLOCK_ELEMENTS: ReadonlySet<string> = new Set(
  (
    'address article aside blockquote body details dialog dd div dl dt fieldset figcaption figure footer form h1 h2 h3 ' +
    'h4 h5 h6 head header hgroup hr html li main menu nav ol p pre section summary table tbody td tfoot th thead tr ul ' +
    'option select optgroup br'
  ).split(' '),
);

/** Names with a hyphen that are not custom elements (React's `isCustomElement`, the HTML Standard's reserved names). */
export const NOT_CUSTOM: ReadonlySet<string> = new Set(
  'annotation-xml color-profile font-face font-face-src font-face-uri font-face-format font-face-name missing-glyph'.split(
    ' ',
  ),
);

/** `input`, `select` and `textarea`: `value` and `checked` become the uncontrolled `defaultValue`, `defaultChecked`. */
export const FORM_FIELDS: ReadonlySet<string> = new Set(['input', 'select', 'textarea']);
