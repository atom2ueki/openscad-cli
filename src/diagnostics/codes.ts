// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// The diagnostic taxonomy. Every diagnostic the CLI emits carries a stable
// `code`; agents are expected to branch on codes rather than on message text,
// because upstream wording changes between releases but these do not.

export interface CodeSpec {
  severity: 'error' | 'warning' | 'note';
  /** Short, actionable guidance shown to the agent. */
  hint: string;
}

/**
 * Keys are matched case-insensitively as substrings of the engine message.
 * Order matters: the first match wins, so put specific patterns first.
 */
const TAXONOMY: ReadonlyArray<readonly [RegExp, string, CodeSpec]> = [
  // --- engine / harness level -------------------------------------------------
  [/top level object is empty/i, 'geometry.empty', {
    severity: 'error',
    hint: 'The model produced no geometry. Check the top-level conditional, e.g. `if (false)`, and that the parameters passed by -D do not disable the body.',
  }],
  [/current top level object is empty/i, 'geometry.empty', {
    severity: 'error',
    hint: 'The model produced no geometry. Check the top-level conditional, e.g. `if (false)`, and that the parameters passed by -D do not disable the body.',
  }],

  // --- geometry quality ------------------------------------------------------
  [/not (?:a )?manifold|self[- ]intersect/i, 'geometry.nonmanifold', {
    severity: 'warning',
    hint: 'The result is not a valid closed solid and most slicers will reject it. Usually a boolean between shapes that only touch at a face or edge; nudge one so they properly overlap.',
  }],
  [/degenerate|zero (?:area|size)|collapsed/i, 'geometry.degenerate', {
    severity: 'warning',
    hint: 'Part of the model collapsed to zero thickness or area. Usually a dimension of 0 or a subtraction that removes everything it touched.',
  }],
  [/cannot resolve|failed to triangulat|self-intersection/i, 'geometry.triangulation', {
    severity: 'warning',
    hint: 'Triangulation failed on part of the model. The exported mesh will have holes. Try a higher $fn, or round the offending edge slightly.',
  }],
  [/CGAL|nef polyhedron/i, 'geometry.backend', {
    severity: 'note',
    hint: 'Message from the CGAL backend. Retry with --backend manifold, which is much faster and usually more robust.',
  }],

  // --- language / parse ------------------------------------------------------
  [/parser error|syntax error/i, 'syntax.parse', {
    severity: 'error',
    hint: 'Syntax error. Check for an unbalanced parenthesis, a missing semicolon, or a missing operator between two expressions.',
  }],
  [/can't parse file|cannot parse/i, 'syntax.unparsable', {
    severity: 'error',
    hint: 'The whole file failed to parse, so nothing was evaluated. Fix the first syntax error reported and re-run.',
  }],
  [/unknown (?:variable|module|function)/i, 'name.unknown', {
    severity: 'warning',
    hint: 'An identifier was used before it was defined. Either define it, or declare it as a top-level variable so -D can supply it.',
  }],
  [/not specified as parameter|unknown parameter|module argument/i, 'module.arguments', {
    severity: 'warning',
    hint: 'A module was called with a name it does not declare. Add the parameter to the module signature, or fix the argument name at the call site.',
  }],
  [/wrong number of arguments|missing argument/i, 'module.arity', {
    severity: 'error',
    hint: 'A module or function was called with the wrong number of arguments. Check the signature.',
  }],
  [/ignoring|redefining|assignment to/i, 'value.redefined', {
    severity: 'warning',
    hint: 'A value is being replaced. Remember OpenSCAD variables are immutable within a scope: the first assignment wins, later ones only produce a warning.',
  }],
  [/assert/i, 'runtime.assert', {
    severity: 'error',
    hint: 'An assert() failed, so evaluation stopped on purpose. The asserted condition is the bug, not the harness.',
  }],
  [/recursion|stack|too deep/i, 'runtime.recursion', {
    severity: 'error',
    hint: 'Recursion went too deep. Check the base case of the recursive function or module.',
  }],
  [/out of range|out of memory|bad_alloc/i, 'runtime.resource', {
    severity: 'error',
    hint: 'The model exceeded a resource limit. Reduce $fn, the loop count, or the extrude slice count.',
  }],

  // --- customizer / parameters ----------------------------------------------
  [/customizer|parameter/i, 'params.customizer', {
    severity: 'warning',
    hint: 'Customizer parameter annotation problem. The [Section] / [min:step:max] comment syntax controls the GUI and -p presets.',
  }],

  // --- external resources ----------------------------------------------------
  [/font/i, 'resource.font', {
    severity: 'warning',
    hint: 'A font could not be resolved. Pass font="<name>:<path>" to text(), or set up fontconfig.',
  }],
  [/unable to open|not found|no such file|can'?t open/i, 'resource.missing', {
    severity: 'error',
    hint: 'A file referenced by the model could not be opened. Paths are resolved relative to the .scad file, not the working directory.',
  }],
  [/include|use<|library/i, 'resource.library', {
    severity: 'warning',
    hint: 'A library could not be resolved. Prefer use<> over include<>; use<> suppresses top-level geometry and keeps error line numbers meaningful.',
  }],
  [/http|download|connection/i, 'resource.network', {
    severity: 'error',
    hint: 'A network fetch failed. include </https://…> needs outbound HTTPS at render time, which will not work in a sandboxed or offline agent run.',
  }],

  // --- export ----------------------------------------------------------------
  [/export/i, 'export.failed', {
    severity: 'error',
    hint: 'The exporter failed. Confirm the target directory exists and the format matches the output extension.',
  }],

  // --- deprecations / traces -------------------------------------------------
  [/deprecated/i, 'lang.deprecated', {
    severity: 'note',
    hint: 'Using a deprecated language feature. Rewrite it to keep the model portable across OpenSCAD versions.',
  }],
];

const DEFAULTS: Record<string, CodeSpec> = {
  WARNING: { severity: 'warning', hint: 'The engine reported a warning. See the message for details.' },
  ERROR: { severity: 'error', hint: 'The engine reported an error. See the message for details.' },
  ECHO: { severity: 'note', hint: '' },
  TRACE: { severity: 'note', hint: '' },
};

export interface Classification {
  severity: 'error' | 'warning' | 'note';
  code: string;
  hint: string;
}

/** Map a raw engine message to a stable code, severity and hint. */
export function classify(message: string, group: string): Classification {
  for (const [pattern, code, spec] of TAXONOMY) {
    if (pattern.test(message)) {
      return { severity: spec.severity, code, hint: spec.hint };
    }
  }
  const fallback = DEFAULTS[group];
  if (fallback) return { severity: fallback.severity, code: `engine.${group.toLowerCase()}`, hint: fallback.hint };
  // A message with no recognised group is still worth surfacing; the engine
  // prints some fatal lines with no prefix at all.
  return { severity: 'error', code: 'engine.unclassified', hint: '' };
}

/** Every code this CLI can emit, for documentation and test coverage. */
export function knownCodes(): string[] {
  return TAXONOMY.map(([, code]) => code);
}
