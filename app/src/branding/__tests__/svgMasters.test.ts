import fs from 'fs';
import path from 'path';

type SvgNode = {
  tag: string;
  attributes: Record<string, string>;
  children: SvgNode[];
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const BRAND_DIR = path.join(REPO_ROOT, 'app', 'assets', 'brand');
const MANIFEST_PATH = path.join(BRAND_DIR, 'source-manifest.json');
const MASTER_VIEW_BOXES: Record<string, string> = {
  'oorva-symbol.svg': '0 0 256 256',
  'oorva-wordmark-light.svg': '0 0 1024 256',
  'oorva-wordmark-dark.svg': '0 0 1024 256',
  'logo-horizontal-light.svg': '0 0 1440 400',
  'logo-horizontal-dark.svg': '0 0 1440 400',
  'logo-stacked-light.svg': '0 0 720 720',
  'logo-stacked-dark.svg': '0 0 720 720',
  'logo-horizontal-mono-black.svg': '0 0 1440 400',
  'logo-horizontal-mono-ivory.svg': '0 0 1440 400',
};
const O01L_PATHS_ADDED_AFTER_FROZEN_PLAN = [
  'app/assets/brand/logo-horizontal-dark.svg',
  'app/assets/brand/logo-horizontal-light.svg',
  'app/assets/brand/logo-horizontal-mono-black.svg',
  'app/assets/brand/logo-horizontal-mono-ivory.svg',
  'app/assets/brand/logo-stacked-dark.svg',
  'app/assets/brand/logo-stacked-light.svg',
  'app/assets/brand/oorva-symbol.svg',
  'app/assets/brand/oorva-wordmark-dark.svg',
  'app/assets/brand/oorva-wordmark-light.svg',
  'app/assets/brand/source-manifest.json',
  'app/src/branding/__tests__/svgMasters.test.ts',
  'docs/design/oorva/evidence/o01l.json',
];
const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'path']);
const NUMERIC_TOKEN = /-?(?:\d+(?:\.\d*)?|\.\d+)/g;

function assertInvariant(
  condition: boolean,
  message: string,
  actual: unknown,
): asserts condition {
  if (!condition) {
    throw new Error(`${message}; actual=${JSON.stringify(actual)}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  assertInvariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    message,
    actual,
  );
}

function assertNear(
  actual: number,
  expected: number,
  tolerance: number,
  message: string,
): void {
  assertInvariant(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    message,
    { actual, expected, tolerance },
  );
}

function parseSvg(markup: string, label: string): SvgNode {
  const documentNode: SvgNode = {
    tag: '#document',
    attributes: {},
    children: [],
  };
  const stack = [documentNode];
  const tokens = /<([^>]+)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokens.exec(markup)) !== null) {
    const text = markup.slice(cursor, match.index);
    assertInvariant(text.trim() === '', `${label} contains non-SVG text`, text);
    cursor = tokens.lastIndex;

    const token = match[1]!.trim();
    assertInvariant(
      !token.startsWith('!') && !token.startsWith('?'),
      `${label} contains an unsupported XML declaration or comment`,
      token,
    );

    if (token.startsWith('/')) {
      const closingTag = token.slice(1).trim();
      const opened = stack.pop();
      assertInvariant(
        opened !== undefined && opened.tag === closingTag,
        `${label} has mismatched XML closing tag`,
        { closingTag, opened: opened?.tag },
      );
      continue;
    }

    const selfClosing = token.endsWith('/');
    const body = selfClosing ? token.slice(0, -1).trim() : token;
    const nameMatch = /^([A-Za-z][\w:-]*)/.exec(body);
    assertInvariant(nameMatch !== null, `${label} has an invalid XML tag`, body);
    const tag = nameMatch![1]!;
    let remaining = body.slice(nameMatch![0].length).trim();
    const attributes: Record<string, string> = {};

    while (remaining.length > 0) {
      const attributeMatch =
        /^([A-Za-z_:][\w:.-]*)="([^"]*)"\s*/.exec(remaining);
      assertInvariant(
        attributeMatch !== null,
        `${label} has an invalid XML attribute`,
        remaining,
      );
      attributes[attributeMatch![1]!] = attributeMatch![2]!;
      remaining = remaining.slice(attributeMatch![0].length);
    }

    const node: SvgNode = { tag, attributes, children: [] };
    const parent = stack[stack.length - 1];
    assertInvariant(parent !== undefined, `${label} has no XML parent`, stack);
    parent.children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }

  const trailingText = markup.slice(cursor);
  assertInvariant(
    trailingText.trim() === '',
    `${label} contains trailing non-SVG text`,
    trailingText,
  );
  assertEqual(stack.length, 1, `${label} has unclosed XML elements`);
  assertEqual(documentNode.children.length, 1, `${label} must have one root`);
  const root = documentNode.children[0];
  assertInvariant(root !== undefined, `${label} has no SVG root`, documentNode);
  assertEqual(root.tag, 'svg', `${label} root element must be svg`);
  return root;
}

function allNodes(node: SvgNode): SvgNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

function pathsIn(node: SvgNode): SvgNode[] {
  return allNodes(node).filter((child) => child.tag === 'path');
}

function groupsByRole(root: SvgNode, role: string): SvgNode[] {
  return allNodes(root).filter(
    (node) => node.tag === 'g' && node.attributes['data-role'] === role,
  );
}

function coordinatePairs(d: string, label: string): Array<[number, number]> {
  const numbers = d.match(NUMERIC_TOKEN)?.map(Number) ?? [];
  assertInvariant(
    numbers.length > 0 && numbers.length % 2 === 0,
    `${label} path must contain coordinate pairs`,
    { d, numbers },
  );
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < numbers.length; index += 2) {
    pairs.push([numbers[index]!, numbers[index + 1]!]);
  }
  return pairs;
}

function getTransform(node: SvgNode, label: string) {
  const value = node.attributes.transform ?? '';
  const translateMatch = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(
    value,
  );
  const scaleMatch =
    /scale\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/.exec(value);
  const unsupported = value
    .replace(/translate\(\s*-?[\d.]+[\s,]+-?[\d.]+\s*\)/, '')
    .replace(/scale\(\s*-?[\d.]+(?:[\s,]+-?[\d.]+)?\s*\)/, '')
    .trim();
  assertInvariant(
    unsupported === '',
    `${label} uses an unexpected transform`,
    value,
  );
  return {
    translateX: translateMatch ? Number(translateMatch[1]) : 0,
    translateY: translateMatch ? Number(translateMatch[2]) : 0,
    scaleX: scaleMatch ? Number(scaleMatch[1]) : 1,
    scaleY: scaleMatch ? Number(scaleMatch[2] ?? scaleMatch[1]) : 1,
  };
}

function boundsFor(node: SvgNode, label: string): Bounds {
  const transform = getTransform(node, label);
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const pathNode of pathsIn(node)) {
    const d = pathNode.attributes.d;
    assertInvariant(d !== undefined, `${label} path is missing d`, pathNode);
    const pairs = coordinatePairs(d, label);
    const strokeWidth = Number(pathNode.attributes['stroke-width'] ?? 0);
    const strokeInsetX = (strokeWidth * transform.scaleX) / 2;
    const strokeInsetY = (strokeWidth * transform.scaleY) / 2;
    for (const [x, y] of pairs) {
      const transformedX = transform.translateX + x * transform.scaleX;
      const transformedY = transform.translateY + y * transform.scaleY;
      bounds.minX = Math.min(bounds.minX, transformedX - strokeInsetX);
      bounds.minY = Math.min(bounds.minY, transformedY - strokeInsetY);
      bounds.maxX = Math.max(bounds.maxX, transformedX + strokeInsetX);
      bounds.maxY = Math.max(bounds.maxY, transformedY + strokeInsetY);
    }
  }

  assertInvariant(
    Number.isFinite(bounds.minX) &&
      Number.isFinite(bounds.minY) &&
      Number.isFinite(bounds.maxX) &&
      Number.isFinite(bounds.maxY),
    `${label} has no measurable vector bounds`,
    bounds,
  );
  return bounds;
}

function readMaster(file: string): { markup: string; root: SvgNode } {
  const markup = fs.readFileSync(path.join(BRAND_DIR, file), 'utf8');
  return { markup, root: parseSvg(markup, file) };
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0]! +
    0.7152 * channels[1]! +
    0.0722 * channels[2]!
  );
}

describe('Oorva outlined SVG candidate masters', () => {
  it('provides each named master as one well-formed self-contained SVG', () => {
    for (const [file, expectedViewBox] of Object.entries(MASTER_VIEW_BOXES)) {
      const { root } = readMaster(file);
      assertEqual(
        root.attributes.viewBox,
        expectedViewBox,
        `${file} viewBox mismatch`,
      );
      assertEqual(
        root.attributes.xmlns,
        'http://www.w3.org/2000/svg',
        `${file} SVG namespace mismatch`,
      );

      const nodes = allNodes(root);
      const invalidElements = nodes
        .map((node) => node.tag)
        .filter((tag) => !ALLOWED_ELEMENTS.has(tag));
      assertEqual(invalidElements, [], `${file} contains non-vector elements`);
      assertInvariant(pathsIn(root).length > 0, `${file} has no vector paths`, {
        paths: pathsIn(root).length,
      });

      for (const node of nodes) {
        const forbiddenAttributes = Object.keys(node.attributes).filter(
          (name) =>
            name === 'href' ||
            name === 'xlink:href' ||
            name.toLowerCase().startsWith('on'),
        );
        assertEqual(
          forbiddenAttributes,
          [],
          `${file} contains an external reference or event handler`,
        );
        const externalContentAttributes = Object.entries(node.attributes)
          .filter(
            ([name, value]) =>
              name.toLowerCase().includes('font') ||
              name.toLowerCase() === 'style' ||
              /url\(|data:image/i.test(value),
          )
          .map(([name, value]) => ({ name, value }));
        assertEqual(
          externalContentAttributes,
          [],
          `${file} contains an external font, style resource, or bitmap payload`,
        );
      }
      for (const pathNode of pathsIn(root)) {
        const d = pathNode.attributes.d;
        assertInvariant(
          d !== undefined &&
            /^[\s\d.,MmCcLlZz+-]+$/.test(d) &&
            /[Mm]/.test(d),
          `${file} has an invalid or empty vector path`,
          d,
        );
        coordinatePairs(d, file);
      }
    }
  });

  it('keeps the symbol and wordmark inside their authored safe zones', () => {
    const { root: symbol } = readMaster('oorva-symbol.svg');
    const symbolBounds = boundsFor(symbol, 'oorva-symbol.svg');
    assertInvariant(
      symbolBounds.minX >= 24 &&
        symbolBounds.minY >= 24 &&
        symbolBounds.maxX <= 232 &&
        symbolBounds.maxY <= 232,
      'symbol ink must remain inside the central 208-square',
      symbolBounds,
    );

    for (const file of [
      'oorva-wordmark-light.svg',
      'oorva-wordmark-dark.svg',
    ]) {
      const { root } = readMaster(file);
      const wordmark = groupsByRole(root, 'wordmark')[0];
      assertInvariant(wordmark !== undefined, `${file} lacks wordmark group`, {
        roles: groupsByRole(root, 'wordmark').length,
      });
      const bounds = boundsFor(wordmark, file);
      assertInvariant(
        bounds.minX >= 52 &&
          bounds.minY >= 52 &&
          bounds.maxX <= 972 &&
          bounds.maxY <= 204,
        `${file} wordmark must retain at least 52 units of clear space`,
        bounds,
      );
    }

    const horizontalFiles = [
      'logo-horizontal-light.svg',
      'logo-horizontal-dark.svg',
      'logo-horizontal-mono-black.svg',
      'logo-horizontal-mono-ivory.svg',
    ];
    for (const file of horizontalFiles) {
      const { root } = readMaster(file);
      const symbolGroup = groupsByRole(root, 'symbol')[0];
      const wordmarkGroup = groupsByRole(root, 'wordmark')[0];
      assertInvariant(
        symbolGroup !== undefined && wordmarkGroup !== undefined,
        `${file} must contain symbol and wordmark groups`,
        { roles: allNodes(root).map((node) => node.attributes['data-role']) },
      );
      const symbolInk = boundsFor(symbolGroup, `${file} symbol`);
      const wordmarkInk = boundsFor(wordmarkGroup, `${file} wordmark`);
      const minimumClearSpace =
        Math.max(
          symbolInk.maxX - symbolInk.minX,
          symbolInk.maxY - symbolInk.minY,
        ) / 4;
      const clearSpace = wordmarkInk.minX - symbolInk.maxX;
      assertInvariant(
        clearSpace >= minimumClearSpace,
        `${file} symbol-to-wordmark clear space must be >= one-quarter symbol`,
        { symbolInk, wordmarkInk, clearSpace, minimumClearSpace },
      );
      const outsideSpace = Math.min(
        symbolInk.minX,
        symbolInk.minY,
        1440 - wordmarkInk.maxX,
        400 - symbolInk.maxY,
        400 - wordmarkInk.maxY,
      );
      assertInvariant(
        outsideSpace >= minimumClearSpace,
        `${file} must retain one-quarter-symbol clear space at the canvas edge`,
        { symbolInk, wordmarkInk, outsideSpace, minimumClearSpace },
      );
    }

    for (const file of ['logo-stacked-light.svg', 'logo-stacked-dark.svg']) {
      const { root } = readMaster(file);
      const symbolGroup = groupsByRole(root, 'symbol')[0];
      const wordmarkGroup = groupsByRole(root, 'wordmark')[0];
      assertInvariant(
        symbolGroup !== undefined && wordmarkGroup !== undefined,
        `${file} must contain symbol and wordmark groups`,
        { roles: allNodes(root).map((node) => node.attributes['data-role']) },
      );
      const symbolInk = boundsFor(symbolGroup, `${file} symbol`);
      const wordmarkInk = boundsFor(wordmarkGroup, `${file} wordmark`);
      const minimumClearSpace =
        Math.max(
          symbolInk.maxX - symbolInk.minX,
          symbolInk.maxY - symbolInk.minY,
        ) / 4;
      const clearSpace = wordmarkInk.minY - symbolInk.maxY;
      assertInvariant(
        clearSpace >= minimumClearSpace,
        `${file} stacked clear space must be >= one-quarter symbol`,
        { symbolInk, wordmarkInk, clearSpace, minimumClearSpace },
      );
      const outsideSpace = Math.min(
        symbolInk.minX,
        symbolInk.minY,
        wordmarkInk.minX,
        720 - wordmarkInk.maxX,
        720 - wordmarkInk.maxY,
        720 - symbolInk.maxY,
      );
      assertInvariant(
        outsideSpace >= minimumClearSpace,
        `${file} must retain one-quarter-symbol clear space at the canvas edge`,
        { symbolInk, wordmarkInk, outsideSpace, minimumClearSpace },
      );
    }
  });

  it('preserves visible open gaps between the two connected-O arcs at 20, 32, and 48 px', () => {
    const { root } = readMaster('oorva-symbol.svg');
    const arcPaths = pathsIn(root);
    const upper = arcPaths.find(
      (node) => node.attributes['data-arc'] === 'upper',
    );
    const lower = arcPaths.find(
      (node) => node.attributes['data-arc'] === 'lower',
    );
    assertInvariant(
      upper !== undefined && lower !== undefined,
      'symbol must expose exactly identifiable upper and lower arc paths',
      arcPaths.map((node) => node.attributes['data-arc']),
    );
    assertEqual(arcPaths.length, 2, 'symbol must contain exactly two arc paths');
    const upperArc = upper!;
    const lowerArc = lower!;
    assertEqual(
      [upperArc, lowerArc].map((node) => node.attributes['stroke-linecap']),
      ['round', 'round'],
      'arc endpoints must use round caps',
    );

    const upperPoints = coordinatePairs(upperArc.attributes.d!, 'upper arc');
    const lowerPoints = coordinatePairs(lowerArc.attributes.d!, 'lower arc');
    const upperStroke = Number(upperArc.attributes['stroke-width']);
    const lowerStroke = Number(lowerArc.attributes['stroke-width']);
    const endpointDistances = [
      Math.hypot(
        upperPoints[0]![0] - lowerPoints[0]![0],
        upperPoints[0]![1] - lowerPoints[0]![1],
      ),
      Math.hypot(
        upperPoints[upperPoints.length - 1]![0] -
          lowerPoints[lowerPoints.length - 1]![0],
        upperPoints[upperPoints.length - 1]![1] -
          lowerPoints[lowerPoints.length - 1]![1],
      ),
    ];
    const sourceGaps = endpointDistances.map(
      (distance) => distance - (upperStroke + lowerStroke) / 2,
    );
    assertEqual(sourceGaps, [32, 32], 'both arc openings must stay 32 units');
    assertEqual(
      [
        upperPoints[0],
        upperPoints[upperPoints.length - 1],
        lowerPoints[0],
        lowerPoints[lowerPoints.length - 1],
      ],
      [
        [44, 164],
        [212, 164],
        [44, 92],
        [212, 92],
      ],
      'symbol arcs must preserve the owner-directed top/bottom C orientation',
    );

    for (const size of [20, 32, 48]) {
      const measuredGaps = sourceGaps.map((gap) => (gap * size) / 256);
      assertInvariant(
        measuredGaps.every((gap) => gap >= 2.5 * (size / 20)),
        `both arc gaps must remain visibly open at ${size}px`,
        { size, measuredGaps, expectedMinimum: 2.5 * (size / 20) },
      );
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assertEqual(
      manifest.smallSizeEvidence.gapUnitsAtBothOpenings,
      sourceGaps[0],
      'manifest small-size source gap differs from parsed SVG geometry',
    );
    assertEqual(
      manifest.smallSizeEvidence.logicalPixelChecks,
      [20, 32, 48].map((size) => ({
        sizePx: size,
        leftGapPx: (sourceGaps[0]! * size) / 256,
        rightGapPx: (sourceGaps[1]! * size) / 256,
        status: 'open',
      })),
      'manifest small-size measurements differ from parsed SVG geometry',
    );
  });

  it('uses compact, rounded lowercase wordmark proportions from the approved direction', () => {
    const { root } = readMaster('oorva-wordmark-light.svg');
    const wordmark = groupsByRole(root, 'wordmark')[0];
    assertInvariant(wordmark !== undefined, 'wordmark group is required', {
      roles: groupsByRole(root, 'wordmark').length,
    });
    const letterPaths = pathsIn(wordmark);
    assertEqual(letterPaths.length, 6, 'custom oorva geometry path count mismatch');
    const bounds = boundsFor(wordmark, 'owner-directed wordmark');
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    assertInvariant(
      width >= 680 && width <= 735 && height >= 125 && height <= 135,
      'custom wordmark should retain the reference’s compact bold proportions',
      {
        bounds,
        width,
        height,
        expectedWidth: [680, 735],
        expectedHeight: [125, 135],
      },
    );
    assertEqual(
      letterPaths.filter((node) => node.attributes['fill-rule'] === 'evenodd')
        .length,
      3,
      'two o counters and the single-storey a counter must be outlined',
    );
  });

  it('keeps exact light, dark, and monochrome variants on matching geometry', () => {
    const wordmarkLight = readMaster('oorva-wordmark-light.svg').root;
    const wordmarkDark = readMaster('oorva-wordmark-dark.svg').root;
    const horizontalLight = readMaster('logo-horizontal-light.svg').root;
    const horizontalDark = readMaster('logo-horizontal-dark.svg').root;
    const horizontalBlack = readMaster('logo-horizontal-mono-black.svg').root;
    const horizontalIvory = readMaster('logo-horizontal-mono-ivory.svg').root;
    const stackedLight = readMaster('logo-stacked-light.svg').root;
    const stackedDark = readMaster('logo-stacked-dark.svg').root;

    const pathData = (root: SvgNode) =>
      pathsIn(root).map((node) => node.attributes.d);
    const symbolMaster = readMaster('oorva-symbol.svg').root;
    assertEqual(
      pathData(symbolMaster),
      pathData(groupsByRole(horizontalLight, 'symbol')[0]!),
      'symbol master geometry differs from horizontal symbol geometry',
    );
    assertEqual(
      pathData(wordmarkLight),
      pathData(groupsByRole(horizontalLight, 'wordmark')[0]!),
      'wordmark master geometry differs from horizontal wordmark geometry',
    );
    assertEqual(
      pathData(wordmarkLight),
      pathData(wordmarkDark),
      'wordmark light/dark outlines differ',
    );
    for (const variant of [
      horizontalDark,
      horizontalBlack,
      horizontalIvory,
    ]) {
      assertEqual(
        pathData(horizontalLight),
        pathData(variant),
        'horizontal variant outlines differ',
      );
      assertEqual(
        allNodes(horizontalLight)
          .filter((node) => node.tag === 'g')
          .map((node) => node.attributes.transform),
        allNodes(variant)
          .filter((node) => node.tag === 'g')
          .map((node) => node.attributes.transform),
        'horizontal variant placement differs',
      );
    }
    assertEqual(
      pathData(stackedLight),
      pathData(stackedDark),
      'stacked light/dark outlines differ',
    );
    assertEqual(
      allNodes(stackedLight)
        .filter((node) => node.tag === 'g')
        .map((node) => node.attributes.transform),
      allNodes(stackedDark)
        .filter((node) => node.tag === 'g')
        .map((node) => node.attributes.transform),
      'stacked variant placement differs',
    );

    const firstWordmarkColor = groupsByRole(wordmarkLight, 'wordmark')[0]
      ?.attributes.fill;
    const darkWordmarkColor = groupsByRole(wordmarkDark, 'wordmark')[0]
      ?.attributes.fill;
    const horizontalLightSymbol = groupsByRole(horizontalLight, 'symbol')[0];
    const horizontalDarkSymbol = groupsByRole(horizontalDark, 'symbol')[0];
    const horizontalBlackWordmark = groupsByRole(horizontalBlack, 'wordmark')[0];
    const horizontalIvoryWordmark = groupsByRole(horizontalIvory, 'wordmark')[0];
    assertEqual(firstWordmarkColor, '#173D39', 'light wordmark color mismatch');
    assertEqual(darkWordmarkColor, '#F7F5EF', 'dark wordmark color mismatch');
    assertEqual(
      horizontalLightSymbol?.children[0]?.attributes.stroke,
      '#173D39',
      'light symbol color mismatch',
    );
    assertEqual(
      horizontalDarkSymbol?.children[0]?.attributes.stroke,
      '#F7F5EF',
      'dark symbol color mismatch',
    );
    assertEqual(
      horizontalBlackWordmark?.attributes.fill,
      '#000000',
      'monochrome black wordmark color mismatch',
    );
    assertEqual(
      horizontalIvoryWordmark?.attributes.fill,
      '#F7F5EF',
      'monochrome ivory wordmark color mismatch',
    );
    assertInvariant(
      groupsByRole(horizontalLight, 'tagline').length === 0 &&
        groupsByRole(horizontalDark, 'tagline').length === 0,
      'tagline geometry must remain separate from SVG masters',
      {
        lightTaglines: groupsByRole(horizontalLight, 'tagline').length,
        darkTaglines: groupsByRole(horizontalDark, 'tagline').length,
      },
    );
  });

  it('records original candidate provenance and pending selection and rights gates', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assertInvariant(
      typeof manifest.conceptRationale === 'string' &&
        manifest.conceptRationale.length > 20,
      'manifest must explain the Connected O concept',
      manifest.conceptRationale,
    );
    assertInvariant(
      typeof manifest.geometryRationale === 'string' &&
        manifest.geometryRationale.length > 20,
      'manifest must explain the original geometry',
      manifest.geometryRationale,
    );
    assertInvariant(
      manifest.originalityProvenance?.authorship?.length > 20 &&
        Array.isArray(manifest.originalityProvenance?.directionalInputs) &&
        manifest.originalityProvenance.directionalInputs.length === 6 &&
        manifest.originalityProvenance?.visualDirection?.status ===
          'OWNER_APPROVED_REFERENCE_ONLY' &&
        manifest.originalityProvenance.visualDirection.file ===
          'oorva-logo-light.png' &&
        manifest.originalityProvenance.visualDirection.sha256 ===
          '4fae9ecb3019efaf0bc1b641728a338408660b649138af922bf66e6ba4179150' &&
        manifest.originalityProvenance?.inputUse?.includes(
          'No PNG paths were copied or traced',
        ),
      'manifest must distinguish owner-approved visual direction from final selection',
      manifest.originalityProvenance,
    );
    assertInvariant(
      typeof manifest.license?.customArtwork === 'string' &&
        manifest.license.customArtwork.length > 10 &&
        manifest.license.customArtwork.includes('D03c is NOT APPROVED') &&
        typeof manifest.license?.taglineFont === 'string',
      'manifest must record artwork and tagline font license status',
      manifest.license,
    );
    assertEqual(
      manifest.masters?.map((master: { file: string; viewBox: string }) => [
        master.file,
        master.viewBox,
      ]),
      Object.entries(MASTER_VIEW_BOXES),
      'manifest master inventory or viewBoxes differ from the authored contract',
    );
    assertEqual(
      manifest.approvalStatus?.status,
      'draft-candidate-only',
      'candidate draft status mismatch',
    );
    assertEqual(
      manifest.approvalStatus?.candidateOnly,
      true,
      'candidate-only state mismatch',
    );
    assertEqual(
      manifest.approvalStatus?.production_ready,
      false,
      'production_ready must remain false',
    );
    assertEqual(
      manifest.approvalStatus?.D03a,
      'APPROVED_AUTHORING_ONLY',
      'D03a must be limited to authoring approval',
    );
    assertEqual(
      manifest.approvalStatus?.D03b,
      'APPROVED_STANDING_CONDITIONAL_ON_O01X_A4_1_VALIDATION',
      'D03b standing selection rule must be recorded without claiming an unexported candidate is selected',
    );
    assertInvariant(
      manifest.approvalStatus?.D03bSelectionRule?.includes(
        'passing all A.4.1 checks',
      ) &&
        manifest.approvalStatus?.D03bCandidateEvidence?.includes(
          'not yet recorded',
        ),
      'D03b approval must remain conditional on O01X candidate validation',
      {
        rule: manifest.approvalStatus?.D03bSelectionRule,
        evidence: manifest.approvalStatus?.D03bCandidateEvidence,
      },
    );
    assertEqual(
      manifest.approvalStatus?.D03c,
      'NOT_APPROVED',
      'D03c public rights must remain not approved',
    );
    assertInvariant(
      manifest.approvalStatus?.D03cScope?.includes(
        'does not block development, private integration, main promotion',
      ),
      'D03c scope must distinguish public release from development gates',
      manifest.approvalStatus?.D03cScope,
    );
    assertEqual(
      manifest.approvalStatus?.visualDirection,
      'OWNER_APPROVED_REFERENCE_ONLY',
      'visual direction approval must not become final selection or rights clearance',
    );
    assertEqual(
      manifest.approvalStatus?.finalSelection,
      false,
      'final selection must remain pending',
    );
    assertEqual(
      manifest.approvalStatus?.publicReleaseAllowed,
      false,
      'public release must remain disabled',
    );

    const evidence = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'docs', 'design', 'oorva', 'evidence', 'o01l.json'),
        'utf8',
      ),
    );
    assertEqual(
      evidence.sourceDrift?.changedPaths,
      O01L_PATHS_ADDED_AFTER_FROZEN_PLAN,
      'source drift must list the exact O01L paths present at the implementation base',
    );
    assertEqual(
      evidence.sourceDrift?.currentMainChangedPaths,
      [],
      'current-main source drift changed',
    );
    assertEqual(
      evidence.smallSizeEvidence?.gapUnitsAtBothOpenings,
      manifest.smallSizeEvidence.gapUnitsAtBothOpenings,
      'evidence small-size measurement differs from manifest',
    );
    assertNear(
      evidence.taglineContrast?.ratio,
      manifest.tagline.contrastEvidence.ratio,
      0.0000005,
      'evidence tagline contrast differs from manifest',
    );
    assertInvariant(
      evidence.sourceDrift?.preservationRationale?.length > 20,
      'evidence must explain why existing current-main changes were preserved',
      evidence.sourceDrift,
    );
    assertEqual(
      evidence.ownerDirectedRevision?.visualDirection?.status,
      'OWNER_APPROVED_REFERENCE_ONLY',
      'evidence must separate approved visual direction from final selection',
    );
    assertEqual(
      evidence.ownerDirectedRevision?.visualDirection?.sha256,
      '4fae9ecb3019efaf0bc1b641728a338408660b649138af922bf66e6ba4179150',
      'evidence owner reference hash mismatch',
    );
    assertEqual(
      evidence.ownerDirectedRevision?.standingD03bApproval?.status,
      'APPROVED_STANDING_CONDITIONAL_ON_O01X_A4_1_VALIDATION',
      'evidence must record the standing conditional D03b approval',
    );
    assertEqual(
      evidence.ownerDirectedRevision?.D03c,
      'NOT_APPROVED',
      'evidence must keep public-rights clearance unapproved',
    );
  });

  it('measures bundled Inter 400 tagline contrast against ivory at WCAG AA', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const tagline = manifest.tagline;
    const backgroundLuminance = relativeLuminance(tagline.background);
    const textLuminance = relativeLuminance(tagline.color);
    const contrast =
      (Math.max(backgroundLuminance, textLuminance) + 0.05) /
      (Math.min(backgroundLuminance, textLuminance) + 0.05);

    assertEqual(tagline.text, 'Your world, closer.', 'tagline copy mismatch');
    assertEqual(tagline.fontFamily, 'Inter', 'tagline font mismatch');
    assertEqual(tagline.fontWeight, 400, 'tagline weight mismatch');
    assertEqual(tagline.background, '#F7F5EF', 'tagline background mismatch');
    assertEqual(tagline.color, '#344B65', 'tagline color mismatch');
    assertNear(
      backgroundLuminance,
      tagline.contrastEvidence.backgroundRelativeLuminance,
      0.0000005,
      'tagline background luminance formula/result mismatch',
    );
    assertNear(
      textLuminance,
      tagline.contrastEvidence.textRelativeLuminance,
      0.0000005,
      'tagline text luminance formula/result mismatch',
    );
    assertNear(
      contrast,
      tagline.contrastEvidence.ratio,
      0.0000005,
      'tagline contrast formula/result mismatch',
    );
    assertInvariant(
      contrast >= 4.5,
      'tagline contrast must meet WCAG AA 4.5:1 on ivory',
      { contrast, minimum: 4.5, tagline },
    );
  });
});
