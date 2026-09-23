// Syntax highlighting themes for the docs' code blocks, in the Pathfinder
// palette. Two VS Code–shaped theme objects, one per environment, handed to
// Starlight's Expressive Code integration from `astro.config.mjs`.
//
// Why a theme and not CSS: Expressive Code inlines every token's colour from
// the active theme, so a stylesheet cannot re-point them without one selector
// per token class. A theme is the one place the colours are decided, and the
// frames, tab bars and buttons around the code keep coming from Starlight's
// own variables (`useStarlightUiThemeColors`), so they stay `brand.css`'s.
//
// The values are the semantic layer's, restated here as literals because a
// theme cannot reference CSS variables: the ground is the code ground the
// block actually paints, the plain text is the page ink, the keyword colour is
// the link colour, comments are the muted ink. Every token colour below was
// measured against its ground and clears 5.5:1, Expressive Code's own floor
// for syntax colours, so the integration never has to adjust one.
//
// The hierarchy, quiet to loud: comments (muted, italic) · punctuation (muted)
// · plain text and variables (ink) · names — types, tags, JSON and YAML keys
// (edge by day, peach by night) · numbers and constants (brass) · strings
// (moss, the one green) · keywords (the link colour) · functions and commands
// (deep rust by day, gold by night, bold). Seven colours, no cool hue.

const palettes = {
  light: {
    type: 'light',
    bg: '#F9EFD6',        // quiet paper's code ground (--sl-color-gray-7)
    fg: '#2A160D',        // ink                       15.05
    muted: '#6E5740',     // muted ink                  5.92
    keyword: '#9E3F0F',   // the link colour            5.78
    string: '#3F5A12',    // moss                       6.84
    constant: '#6E4519',  // brass, dark                7.26
    fn: '#8A3609',        // deep rust                  7.02
    name: '#553316',      // edge                       9.80
    invalid: '#7A2E2E',   // wine                       8.13
  },
  dark: {
    type: 'dark',
    bg: '#23272C',        // the night code ground (--sl-color-gray-6)
    fg: '#F7F0DF',        // lamplight                 13.22
    muted: '#B3A78E',     // muted lamplight            6.32
    keyword: '#F0A97E',   // the link colour            7.64
    string: '#C5D28E',    // pale moss                  9.29
    constant: '#E2B26A',  // brass, lit                 7.73
    fn: '#F2D98A',        // gold                      10.78
    name: '#F5C7A6',      // peach                      9.73
    invalid: '#F28B6B',   // ember                      7.05
  },
};

/** One theme from one palette. Later rules win ties, so specific overrides come last. */
function buildTheme(name, p) {
  const rule = (scope, settings) => ({ scope, settings });
  return {
    name,
    type: p.type,
    semanticHighlighting: false,
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
    },
    tokenColors: [
      rule(['source', 'text', 'meta.embedded', 'variable', 'variable.other', 'variable.parameter', 'meta.function-call.arguments'], { foreground: p.fg }),

      // Quiet: comments and punctuation.
      rule(['comment', 'punctuation.definition.comment', 'string.quoted.docstring', 'markup.quote'], { foreground: p.muted, fontStyle: 'italic' }),
      rule(['punctuation', 'meta.brace', 'keyword.operator', 'punctuation.separator', 'punctuation.terminator', 'punctuation.definition.string'], { foreground: p.muted }),

      // Names: types, tags, and keys.
      rule(['entity.name.type', 'entity.name.class', 'entity.name.namespace', 'support.type', 'support.class', 'entity.name.tag', 'entity.name.tag.yaml', 'support.type.property-name', 'meta.object-literal.key', 'entity.other.attribute-name.class'], { foreground: p.name }),

      // Values: numbers, language constants, escapes, shell variables, attributes.
      rule(['constant', 'constant.numeric', 'constant.language', 'constant.character.escape', 'constant.other', 'support.constant', 'variable.other.constant', 'variable.other.normal.shell', 'variable.other.special.shell', 'variable.parameter.positional', 'entity.other.attribute-name'], { foreground: p.constant }),

      // Strings, and code spans in Markdown.
      rule(['string', 'string.quoted', 'string.template', 'string.regexp', 'markup.inline.raw', 'markup.raw'], { foreground: p.string }),
      rule(['string punctuation.definition.string', 'string variable', 'string constant.character.escape'], { foreground: p.constant }),

      // Keywords and builtins.
      rule(['keyword', 'keyword.control', 'keyword.other', 'storage', 'storage.type', 'storage.modifier', 'variable.language', 'support.function.builtin', 'keyword.operator.new', 'keyword.operator.expression', 'keyword.operator.logical'], { foreground: p.keyword }),

      // Functions and shell commands.
      rule(['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'entity.name.command', 'entity.name.function.call'], { foreground: p.fn, fontStyle: 'bold' }),
      rule(['support.function.builtin'], { foreground: p.keyword, fontStyle: '' }),

      // Markdown structure.
      rule(['markup.heading', 'entity.name.section', 'markup.heading entity.name'], { foreground: p.fg, fontStyle: 'bold' }),
      rule(['punctuation.definition.heading', 'punctuation.definition.list', 'markup.list punctuation.definition'], { foreground: p.keyword }),
      rule(['markup.bold'], { fontStyle: 'bold' }),
      rule(['markup.italic'], { fontStyle: 'italic' }),
      rule(['markup.underline.link', 'string.other.link', 'constant.other.reference.link'], { foreground: p.keyword, fontStyle: 'underline' }),
      rule(['markup.fenced_code.block', 'markup.fenced_code.block punctuation.definition'], { foreground: p.fg }),

      rule(['invalid', 'invalid.illegal', 'invalid.deprecated'], { foreground: p.invalid }),
    ],
  };
}

export const codeThemes = [
  buildTheme('pathfinder-night', palettes.dark),
  buildTheme('pathfinder-day', palettes.light),
];
