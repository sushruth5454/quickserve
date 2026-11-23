import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

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

type Point = [number, number];
type CubicSegment = [Point, Point, Point, Point];

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const BRAND_DIR = path.join(REPO_ROOT, 'app', 'assets', 'brand');
const DROP_IN_DIR = path.join(
  REPO_ROOT,
  'docs',
  'design',
  'oorva',
  'logo',
  'vector',
  'app-assets',
);
const MANIFEST_PATH = path.join(BRAND_DIR, 'source-manifest.json');
const SOURCE_COMMIT = 'f6c627bebf18ee8a4b488bdb802aa999c15281cb';
const SOURCE_README = 'docs/design/oorva/logo/vector/README.md';
const SOURCE_README_SHA256 =
  '4137e340929fcd75c9fa21e3b83265cd109091ca81928738426325bf8df0ed4f';
const CONTACT_SHEET = 'docs/design/oorva/logo/vector/app-assets-contact-sheet.png';
const CONTACT_SHEET_SHA256 =
  '3242d927c79c88acc90f5fc5d19605730cc2301946759924a162fe430531ab05';
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
const SOURCE_HASHES: Record<string, string> = {
  'oorva-symbol.svg':
    '2dfca9f88406103dd9a5f1d709a326579eaebfadb55762a97b22226ae69c8c73',
  'oorva-wordmark-light.svg':
    'b31229342972163a3f8f026b4dd65238fd88b8b533976be2abce234b9c08df0f',
  'oorva-wordmark-dark.svg':
    'c5b4eba1a14f78ca39f43c366b913dc9b469b0a7cb60f429674fb6580eab7b55',
  'logo-horizontal-light.svg':
    '9a466913e211e2670c0652d8db859bbc1cd7d678c4e5ff156746805d42f25e2f',
  'logo-horizontal-dark.svg':
    'f05f062716a80b71e771d77d138387d8d28399286682e0adab136f6a7ccb19ab',
  'logo-stacked-light.svg':
    'd7053575e62315d12521ed6f7217c5bbe3e892d7eb792efb0e847b396ec22781',
  'logo-stacked-dark.svg':
    'efd5aec2284df3e4b442221cb9c3b5cfeff47fc5066566562cf2f08f2f9058b6',
  'logo-horizontal-mono-black.svg':
    'b8629fcffdc7c0921bcaebfe5e0812d851f147dc45359fe21ce49c9539b7b322',
  'logo-horizontal-mono-ivory.svg':
    'f05f062716a80b71e771d77d138387d8d28399286682e0adab136f6a7ccb19ab',
};
const FIT_TRANSFORMS: Record<
  string,
  { center: [number, number]; scale: number; family: 'horizontal' | 'wordmark' }
> = {
  'logo-horizontal-light.svg': {
    center: [720, 200],
    scale: 0.88,
    family: 'horizontal',
  },
  'logo-horizontal-dark.svg': {
    center: [720, 200],
    scale: 0.88,
    family: 'horizontal',
  },
  'logo-horizontal-mono-black.svg': {
    center: [720, 200],
    scale: 0.88,
    family: 'horizontal',
  },
  'logo-horizontal-mono-ivory.svg': {
    center: [720, 200],
    scale: 0.88,
    family: 'horizontal',
  },
  'oorva-wordmark-light.svg': {
    center: [512, 128],
    scale: 0.86,
    family: 'wordmark',
  },
  'oorva-wordmark-dark.svg': {
    center: [512, 128],
    scale: 0.86,
    family: 'wordmark',
  },
};
const O01X_SAFE_MARGIN_FINDINGS = [
  {
    path: 'app/assets/brand/logo-horizontal-light.png',
    canvas: [360, 100],
    margins: [43, 15, 43, 15],
    symbolDiameterPx: 70,
  },
  {
    path: 'app/assets/brand/logo-horizontal-light@2x.png',
    canvas: [720, 200],
    margins: [87, 30, 87, 30],
    symbolDiameterPx: 140,
  },
  {
    path: 'app/assets/brand/logo-horizontal-light@3x.png',
    canvas: [1080, 300],
    margins: [130, 45, 130, 45],
    symbolDiameterPx: 210,
  },
  {
    path: 'app/assets/brand/logo-horizontal-dark.png',
    canvas: [360, 100],
    margins: [43, 15, 43, 15],
    symbolDiameterPx: 70,
  },
  {
    path: 'app/assets/brand/logo-horizontal-dark@2x.png',
    canvas: [720, 200],
    margins: [87, 30, 87, 30],
    symbolDiameterPx: 140,
  },
  {
    path: 'app/assets/brand/logo-horizontal-dark@3x.png',
    canvas: [1080, 300],
    margins: [130, 45, 130, 45],
    symbolDiameterPx: 210,
  },
  {
    path: 'app/assets/brand/oorva-wordmark-light.png',
    canvas: [256, 64],
    margins: [17, 10, 17, 10],
    symbolDiameterPx: 47,
  },
  {
    path: 'app/assets/brand/oorva-wordmark-light@2x.png',
    canvas: [512, 128],
    margins: [35, 20, 35, 20],
    symbolDiameterPx: 93,
  },
  {
    path: 'app/assets/brand/oorva-wordmark-light@3x.png',
    canvas: [768, 192],
    margins: [53, 30, 53, 30],
    symbolDiameterPx: 138,
  },
  {
    path: 'app/assets/brand/oorva-wordmark-dark.png',
    canvas: [256, 64],
    margins: [17, 10, 17, 10],
    symbolDiameterPx: 47,
  },
  {
    path: 'app/assets/brand/oorva-wordmark-dark@2x.png',
    canvas: [512, 128],
    margins: [35, 20, 35, 20],
    symbolDiameterPx: 93,
  },
  {
    path: 'app/assets/brand/oorva-wordmark-dark@3x.png',
    canvas: [768, 192],
    margins: [53, 30, 53, 30],
    symbolDiameterPx: 138,
  },
];
const O01X_MANIFEST_SHA256 =
  '544df2f08d8e09ea1e3143c4363d29ed2801b5103caad69e76cbf900ef641877';
const SAFE_MARGIN_ROUNDING_BUFFER_PX = 1;
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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}; actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
  }
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
  return allNodes(root).filter((node) => node.attributes['data-role'] === role);
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

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number) {
  const inverse = 1 - t;
  return (
    inverse ** 3 * p0 +
    3 * inverse ** 2 * t * p1 +
    3 * inverse * t ** 2 * p2 +
    t ** 3 * p3
  );
}

function cubicSubpaths(d: string, label: string): CubicSegment[][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+(?:\.\d*)?|\.\d+)/g) ?? [];
  const subpaths: CubicSegment[][] = [];
  let segments: CubicSegment[] = [];
  let index = 0;
  let command = '';
  let current: Point | undefined;
  let start: Point | undefined;

  const closeSubpath = () => {
    if (current && start && Math.hypot(current[0] - start[0], current[1] - start[1]) > 1e-9) {
      segments.push([
        current,
        [
          current[0] + (start[0] - current[0]) / 3,
          current[1] + (start[1] - current[1]) / 3,
        ],
        [
          current[0] + (2 * (start[0] - current[0])) / 3,
          current[1] + (2 * (start[1] - current[1])) / 3,
        ],
        start,
      ]);
    }
    if (segments.length > 0) subpaths.push(segments);
    segments = [];
  };

  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index]!)) {
      command = tokens[index]!;
      index += 1;
    }
    if (command === 'M') {
      closeSubpath();
      current = [Number(tokens[index]!), Number(tokens[index + 1]!)];
      start = current;
      index += 2;
      command = '';
      continue;
    }
    if (command === 'C') {
      const values = tokens.slice(index, index + 6).map(Number);
      assertEqual(values.length, 6, `${label} cubic gap path segment is incomplete`);
      assertInvariant(current !== undefined, `${label} cubic segment lacks a start`, {
        index,
        token: tokens[index],
      });
      const end: Point = [values[4]!, values[5]!];
      segments.push([
        current,
        [values[0]!, values[1]!],
        [values[2]!, values[3]!],
        end,
      ]);
      current = end;
      index += 6;
      command = '';
      continue;
    }
    if (command === 'Z' || command === 'z') {
      closeSubpath();
      current = start;
      start = undefined;
      command = '';
      continue;
    }
    assertInvariant(false, `${label} uses an unsupported cubic path command`, {
      command,
      index,
      token: tokens[index],
    });
  }
  closeSubpath();
  assertInvariant(subpaths.length > 0, `${label} has no cubic subpaths`, d);
  return subpaths;
}

function sampledCubicPath(
  segments: CubicSegment[],
  subdivisions: number,
  scale: number,
  translateX: number,
  translateY: number,
): Point[] {
  const points: Point[] = [];
  for (const [p0, p1, p2, p3] of segments) {
    for (let step = 0; step <= subdivisions; step += 1) {
      const t = step / subdivisions;
      points.push([
        translateX + cubicAt(p0[0], p1[0], p2[0], p3[0], t) * scale,
        translateY + cubicAt(p0[1], p1[1], p2[1], p3[1], t) * scale,
      ]);
    }
  }
  return points;
}

function minimumSideGap(
  left: Point[],
  right: Point[],
  side: 'left' | 'right',
  centerX: number,
) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const first of left) {
    if (side === 'left' ? first[0] >= centerX : first[0] <= centerX) continue;
    for (const second of right) {
      if (side === 'left' ? second[0] >= centerX : second[0] <= centerX) continue;
      minimum = Math.min(minimum, Math.hypot(first[0] - second[0], first[1] - second[1]));
    }
  }
  return minimum;
}

function cubicDerivativeRoots(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    return Math.abs(b) < 1e-12 ? [] : [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function cubicPathBounds(d: string, label: string): Bounds {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+(?:\.\d*)?|\.\d+)/g) ?? [];
  const points: Array<[number, number]> = [];
  let index = 0;
  let command = '';
  let current: [number, number] = [0, 0];
  let subpathStart: [number, number] = [0, 0];
  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index]!)) {
      command = tokens[index]!;
      index += 1;
    }
    if (command === 'M') {
      current = [Number(tokens[index]!), Number(tokens[index + 1]!)];
      subpathStart = current;
      points.push(current);
      index += 2;
      command = '';
      continue;
    }
    if (command === 'C') {
      const values = tokens.slice(index, index + 6).map(Number);
      assertEqual(values.length, 6, `${label} cubic path segment is incomplete`);
      const p0 = current;
      const p1: [number, number] = [values[0]!, values[1]!];
      const p2: [number, number] = [values[2]!, values[3]!];
      const p3: [number, number] = [values[4]!, values[5]!];
      points.push(p0, p3);
      for (const axis of [0, 1] as const) {
        for (const t of cubicDerivativeRoots(
          p0[axis],
          p1[axis],
          p2[axis],
          p3[axis],
        )) {
          if (t > 0 && t < 1) {
            points.push([
              cubicAt(p0[0], p1[0], p2[0], p3[0], t),
              cubicAt(p0[1], p1[1], p2[1], p3[1], t),
            ]);
          }
        }
      }
      current = p3;
      index += 6;
      command = '';
      continue;
    }
    if (command === 'Z' || command === 'z') {
      points.push(subpathStart);
      current = subpathStart;
      command = '';
      continue;
    }
    assertInvariant(false, `${label} uses an unsupported path command`, {
      command,
      index,
      token: tokens[index],
    });
  }
  assertInvariant(points.length > 0, `${label} has no measurable path points`, d);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
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

function centeredFitTransform(
  source: ReturnType<typeof getTransform>,
  center: [number, number],
  factor: number,
) {
  return {
    translateX: center[0] + factor * (source.translateX - center[0]),
    translateY: center[1] + factor * (source.translateY - center[1]),
    scaleX: source.scaleX * factor,
    scaleY: source.scaleY * factor,
  };
}

function projectedSafeMarginEvidence() {
  return O01X_SAFE_MARGIN_FINDINGS.map((finding) => {
    const family = finding.path.includes('logo-horizontal')
      ? 'horizontal'
      : 'wordmark';
    const fit =
      family === 'horizontal'
        ? FIT_TRANSFORMS['logo-horizontal-light.svg']!
        : FIT_TRANSFORMS['oorva-wordmark-light.svg']!;
    const minimumMarginPx = Math.ceil(finding.symbolDiameterPx / 4);
    const halfCanvas = [
      finding.canvas[0]! / 2,
      finding.canvas[1]! / 2,
      finding.canvas[0]! / 2,
      finding.canvas[1]! / 2,
    ];
    const projectedMargins = finding.margins.map(
      (margin, index) =>
        halfCanvas[index]! -
        fit.scale * (halfCanvas[index]! - margin),
    );
    const requiredWithBufferPx =
      minimumMarginPx + SAFE_MARGIN_ROUNDING_BUFFER_PX;
    const maximumScaleWithBuffer = Math.min(
      ...finding.margins.map((margin, index) => {
        const extentFromCenter = halfCanvas[index]! - margin;
        return extentFromCenter === 0
          ? Number.POSITIVE_INFINITY
          : (halfCanvas[index]! - requiredWithBufferPx) / extentFromCenter;
      }),
    );

    return {
      path: finding.path,
      family,
      canvas: finding.canvas,
      beforeMarginsPx: finding.margins,
      symbolDiameterPx: finding.symbolDiameterPx,
      minimumMarginPx,
      scale: fit.scale,
      projectedMarginsPx: projectedMargins.map((margin) =>
        Number(margin.toFixed(6)),
      ),
      conservativeIntegerMarginsPx: projectedMargins.map(Math.floor),
      maximumScaleWithOnePixelBuffer: Number(
        maximumScaleWithBuffer.toFixed(9),
      ),
    };
  });
}

function boundsFor(node: SvgNode, label: string, role?: string): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const pathNode of pathsIn(node)) {
    if (role && pathNode.attributes['data-role'] !== role) continue;
    const d = pathNode.attributes.d;
    assertInvariant(d !== undefined, `${label} path is missing d`, pathNode);
    const transform = getTransform(pathNode, label);
    const localBounds = cubicPathBounds(d, label);
    const strokeWidth = Number(pathNode.attributes['stroke-width'] ?? 0);
    const strokeInsetX = (strokeWidth * transform.scaleX) / 2;
    const strokeInsetY = (strokeWidth * transform.scaleY) / 2;
    bounds.minX = Math.min(
      bounds.minX,
      transform.translateX + localBounds.minX * transform.scaleX - strokeInsetX,
    );
    bounds.minY = Math.min(
      bounds.minY,
      transform.translateY + localBounds.minY * transform.scaleY - strokeInsetY,
    );
    bounds.maxX = Math.max(
      bounds.maxX,
      transform.translateX + localBounds.maxX * transform.scaleX + strokeInsetX,
    );
    bounds.maxY = Math.max(
      bounds.maxY,
      transform.translateY + localBounds.maxY * transform.scaleY + strokeInsetY,
    );
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
  it('matches the exact current-main drop-ins as well-formed self-contained SVGs', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assertEqual(
      manifest.originalityProvenance?.sourceCommit,
      SOURCE_COMMIT,
      'drop-in source commit mismatch',
    );
    assertEqual(
      manifest.originalityProvenance?.sourceReadme,
      SOURCE_README,
      'drop-in source README mismatch',
    );
    assertEqual(
      manifest.originalityProvenance?.sourceReadmeSha256,
      SOURCE_README_SHA256,
      'drop-in source README hash mismatch',
    );
    assertEqual(
      sha256(fs.readFileSync(path.join(REPO_ROOT, SOURCE_README))),
      SOURCE_README_SHA256,
      'source README bytes differ from recorded provenance',
    );
    assertEqual(
      manifest.originalityProvenance?.sourceMasterSha256,
      SOURCE_HASHES,
      'manifest source hash inventory mismatch',
    );
    assertEqual(
      Object.keys(
        manifest.safeMarginCorrection?.destinationMasterSha256 ?? {},
      ).sort(),
      Object.keys(MASTER_VIEW_BOXES).sort(),
      'safe-margin evidence must hash every destination master',
    );

    for (const [file, expectedViewBox] of Object.entries(MASTER_VIEW_BOXES)) {
      const sourceBytes = fs.readFileSync(path.join(DROP_IN_DIR, file));
      const destinationBytes = fs.readFileSync(path.join(BRAND_DIR, file));
      const sourceHash = sha256(sourceBytes);
      const destinationHash = sha256(destinationBytes);
      assertEqual(
        sourceHash,
        SOURCE_HASHES[file],
        `${file} source hash mismatch`,
      );
      assertEqual(
        destinationHash,
        manifest.safeMarginCorrection?.destinationMasterSha256?.[file],
        `${file} destination hash differs from the recorded final master`,
      );
      const sourceRoot = parseSvg(sourceBytes.toString('utf8'), `${file} source`);
      const root = parseSvg(destinationBytes.toString('utf8'), file);
      assertEqual(
        root.attributes.viewBox,
        expectedViewBox,
        `${file} viewBox mismatch`,
      );
      assertEqual(
        root.attributes.viewBox,
        sourceRoot.attributes.viewBox,
        `${file} viewBox changed from its supplied master`,
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
      const expectedRoles = file === 'oorva-symbol.svg'
        ? ['symbol']
        : file.startsWith('oorva-wordmark-')
          ? ['wordmark']
          : ['symbol', 'wordmark'];
      assertEqual(
        pathsIn(root).map((node) => node.attributes['data-role']),
        expectedRoles,
        `${file} source role sequence mismatch`,
      );
      const fit = FIT_TRANSFORMS[file];
      if (!fit) {
        assertInvariant(
          sourceBytes.equals(destinationBytes),
          `${file} must remain a byte-for-byte source master`,
          { sourceHash, destinationHash },
        );
      } else {
        const sourcePaths = pathsIn(sourceRoot);
        const destinationPaths = pathsIn(root);
        assertEqual(
          destinationPaths.map((node) => node.attributes.d),
          sourcePaths.map((node) => node.attributes.d),
          `${file} path contours changed`,
        );
        for (let index = 0; index < sourcePaths.length; index += 1) {
          const sourcePath = sourcePaths[index]!;
          const destinationPath = destinationPaths[index]!;
          for (const attribute of ['data-role', 'fill', 'fill-rule']) {
            assertEqual(
              destinationPath.attributes[attribute],
              sourcePath.attributes[attribute],
              `${file} ${attribute} changed`,
            );
          }
          const sourceTransform = getTransform(
            sourcePath,
            `${file} source path`,
          );
          const destinationTransform = getTransform(
            destinationPath,
            `${file} fitted path`,
          );
          const expectedTransform = centeredFitTransform(
            sourceTransform,
            fit.center,
            fit.scale,
          );
          assertNear(
            destinationTransform.translateX,
            expectedTransform.translateX,
            0.0000001,
            `${file} centered-fit x translation mismatch`,
          );
          assertNear(
            destinationTransform.translateY,
            expectedTransform.translateY,
            0.0000001,
            `${file} centered-fit y translation mismatch`,
          );
          assertNear(
            destinationTransform.scaleX,
            expectedTransform.scaleX,
            0.0000001,
            `${file} uniform-fit x scale mismatch`,
          );
          assertNear(
            destinationTransform.scaleY,
            expectedTransform.scaleY,
            0.0000001,
            `${file} uniform-fit y scale mismatch`,
          );
          assertEqual(
            destinationTransform.scaleX,
            destinationTransform.scaleY,
            `${file} fit must preserve aspect ratio`,
          );
        }
      }

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

    for (const family of ['horizontal', 'wordmark'] as const) {
      assertEqual(
        manifest.safeMarginCorrection?.fits?.[family]?.scale,
        FIT_TRANSFORMS[
          family === 'horizontal'
            ? 'logo-horizontal-light.svg'
            : 'oorva-wordmark-light.svg'
        ]?.scale,
        `${family} fit factor differs from its test contract`,
      );
      assertEqual(
        manifest.safeMarginCorrection?.fits?.[family]?.center,
        FIT_TRANSFORMS[
          family === 'horizontal'
            ? 'logo-horizontal-light.svg'
            : 'oorva-wordmark-light.svg'
        ]?.center,
        `${family} fit center differs from its test contract`,
      );
    }
  });

  it('records the official A.4.1 findings and a rounded-margin-safe centered fit', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const correction = manifest.safeMarginCorrection;
    const projectedMargins = projectedSafeMarginEvidence();
    assertEqual(
      correction?.officialValidationBeforeFit,
      {
        validator: 'O01X official current-main Codespace assets selector',
        validatedO01LHead: 'a5d42b45f7afd201b8c968229e9302b92c8ef9a1',
        candidateManifestSha256: O01X_MANIFEST_SHA256,
        helperSource:
          'origin/main:scripts/cs-test.ps1 at f6c627bebf18ee8a4b488bdb802aa999c15281cb',
        command: 'pwsh -NoProfile -File $Helper -Suite assets -Filter oorva',
        codespace: 'qs-tests-g67pgv4xqj639gx5',
        wipSnapshotBranch: 'wip/qs-o01x-fixforward-f6c627b',
        wipSnapshotSha: 'bc228eda61e2c0d0f7f2df136f1bf42163c630ea',
        status: 'FAIL',
        checkedFileCount: 26,
        findingCount: 12,
        findingTypes: ['clear-space'],
        validateSafeZoneRan: true,
        otherAssetAssertions:
          'PASS; validator returned exactly these 12 findings.',
      },
      'manifest must identify the official pre-fit clear-space failure',
    );
    assertEqual(
      correction?.roundingBufferPx,
      SAFE_MARGIN_ROUNDING_BUFFER_PX,
      'safe-margin fit must retain its pixel-rounding buffer',
    );
    assertEqual(
      correction?.officialFindings,
      O01X_SAFE_MARGIN_FINDINGS,
      'manifest must preserve the exact per-density official findings',
    );
    assertEqual(
      correction?.projectedMargins,
      projectedMargins,
      'manifest projected margins differ from the deterministic calculation',
    );

    for (const projected of projectedMargins) {
      assertInvariant(
        projected.scale <= projected.maximumScaleWithOnePixelBuffer,
        'uniform fit exceeds the maximum scale that preserves one-pixel raster buffer',
        projected,
      );
      assertInvariant(
        projected.conservativeIntegerMarginsPx.every(
          (margin) =>
            margin >=
            projected.minimumMarginPx + SAFE_MARGIN_ROUNDING_BUFFER_PX,
        ),
        'projected raster margins do not clear the A.4.1 threshold plus buffer',
        projected,
      );
    }

    for (const family of ['horizontal', 'wordmark'] as const) {
      const familyMargins = projectedMargins.filter(
        (projected) => projected.family === family,
      );
      const maximumScale = Math.min(
        ...familyMargins.map(
          (projected) => projected.maximumScaleWithOnePixelBuffer,
        ),
      );
      const selectedScale =
        correction.fits[family].scale as number;
      assertInvariant(
        selectedScale + 0.01 > maximumScale,
        'selected scale is not the largest hundredth that fits every density with the buffer',
        { family, selectedScale, maximumScale, familyMargins },
      );
      assertEqual(
        correction.fits[family].maximumScaleWithOnePixelBuffer,
        maximumScale,
        `${family} documented tightest scale limit mismatch`,
      );
    }

    const evidence = JSON.parse(
      fs.readFileSync(
        path.join(
          REPO_ROOT,
          'docs',
          'design',
          'oorva',
          'evidence',
          'o01l.json',
        ),
        'utf8',
      ),
    );
    assertEqual(
      evidence.safeMarginCorrection,
      correction,
      'O01L evidence must mirror the manifest safe-margin calculations',
    );
  });

  it('keeps the symbol and wordmark inside their authored safe zones', () => {
    const { root: symbol } = readMaster('oorva-symbol.svg');
    const symbolBounds = boundsFor(symbol, 'oorva-symbol.svg');
    assertInvariant(
      symbolBounds.minX >= 23.99 &&
        symbolBounds.minY >= 23.99 &&
        symbolBounds.maxX <= 232.01 &&
        symbolBounds.maxY <= 232.01,
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
        `${file} wordmark must retain one-quarter-symbol clear space in its viewBox`,
        { bounds, minimum: 52 },
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
      const minimumClearSpace = 52;
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
      const minimumClearSpace = 52;
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

  it('keeps both supplied Connected O openings visibly open at 20, 32, and 48 px', () => {
    const { root } = readMaster('oorva-symbol.svg');
    const symbolPath = groupsByRole(root, 'symbol')[0];
    assertInvariant(
      symbolPath !== undefined && pathsIn(root).length === 1,
      'supplied symbol must be one self-contained compound path',
      { roles: pathsIn(root).map((node) => node.attributes['data-role']) },
    );
    const d = symbolPath!.attributes.d!;
    const transform = getTransform(symbolPath, 'supplied symbol');
    assertEqual(
      [transform.translateX, transform.translateY, transform.scaleX, transform.scaleY],
      [0.65, -3.75, 0.86225, 0.86225],
      'supplied symbol transform changed from its source master',
    );
    const subpaths = cubicSubpaths(d, 'supplied symbol');
    assertEqual(subpaths.length, 2, 'Connected O must retain two compound subpaths');
    const first = sampledCubicPath(
      subpaths[0]!,
      120,
      transform.scaleX,
      transform.translateX,
      transform.translateY,
    );
    const second = sampledCubicPath(
      subpaths[1]!,
      120,
      transform.scaleX,
      transform.translateX,
      transform.translateY,
    );
    const centerX = transform.translateX + 128 * transform.scaleX;
    const gaps256 = [
      minimumSideGap(first, second, 'left', centerX),
      minimumSideGap(first, second, 'right', centerX),
    ];

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assertEqual(
      manifest.smallSizeEvidence.samplesPerCubic,
      120,
      'small-size sampling resolution mismatch',
    );
    assertNear(
      gaps256[0]!,
      manifest.smallSizeEvidence.minimumGapUnitsAfterTransform.left,
      0.000001,
      'recorded transformed left gap differs from the source paths',
    );
    assertNear(
      gaps256[1]!,
      manifest.smallSizeEvidence.minimumGapUnitsAfterTransform.right,
      0.000001,
      'recorded transformed right gap differs from the source paths',
    );
    for (const size of [20, 32, 48]) {
      const measuredGaps = gaps256.map((gap) => (gap * size) / 256);
      assertInvariant(
        measuredGaps.every((gap) => gap >= 0.5 * (size / 20)),
        `both arc gaps must remain visibly open at ${size}px`,
        { size, measuredGaps, expectedMinimum: 0.5 * (size / 20) },
      );
      const recorded = manifest.smallSizeEvidence.logicalPixelChecks.find(
        (check: { sizePx: number }) => check.sizePx === size,
      );
      assertInvariant(
        recorded !== undefined,
        `manifest small-size evidence is missing ${size}px`,
        manifest.smallSizeEvidence.logicalPixelChecks,
      );
      assertNear(
        measuredGaps[0]!,
        recorded.leftGapPx,
        0.000001,
        `recorded left gap differs from supplied symbol at ${size}px`,
      );
      assertNear(
        measuredGaps[1]!,
        recorded.rightGapPx,
        0.000001,
        `recorded right gap differs from supplied symbol at ${size}px`,
      );
    }
    assertEqual(
      manifest.smallSizeEvidence.visualSource?.path,
      CONTACT_SHEET,
      'small-size evidence must point to the supplied source contact sheet',
    );
    assertEqual(
      manifest.smallSizeEvidence.visualSource?.sha256,
      CONTACT_SHEET_SHA256,
      'small-size contact-sheet hash mismatch',
    );
    const contactSheetBytes = fs.readFileSync(path.join(REPO_ROOT, CONTACT_SHEET));
    assertEqual(
      sha256(contactSheetBytes),
      CONTACT_SHEET_SHA256,
      'contact-sheet visual evidence hash mismatch',
    );
  });

  it('uses the supplied outlined lowercase wordmark within its A.4.1 canvas', () => {
    const { root } = readMaster('oorva-wordmark-light.svg');
    const wordmark = groupsByRole(root, 'wordmark')[0];
    assertInvariant(wordmark !== undefined, 'wordmark group is required', {
      roles: groupsByRole(root, 'wordmark').length,
    });
    const letterPaths = pathsIn(wordmark);
    assertEqual(letterPaths.length, 1, 'source wordmark must remain one outlined compound path');
    const bounds = boundsFor(wordmark, 'owner-directed wordmark');
    assertInvariant(
      bounds.minX >= 52 &&
        bounds.minY >= 52 &&
        bounds.maxX <= 972 &&
        bounds.maxY <= 204,
      'fitted wordmark must retain one-quarter-symbol clear space',
      { bounds, minimum: 52 },
    );
    assertEqual(
      letterPaths[0]?.attributes['fill-rule'],
      'evenodd',
      'supplied lowercase wordmark counters must remain vector cutouts',
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
        groupsByRole(horizontalLight, 'symbol')
          .concat(groupsByRole(horizontalLight, 'wordmark'))
          .map((node) => node.attributes.transform),
        groupsByRole(variant, 'symbol')
          .concat(groupsByRole(variant, 'wordmark'))
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
      groupsByRole(stackedLight, 'symbol')
        .concat(groupsByRole(stackedLight, 'wordmark'))
        .map((node) => node.attributes.transform),
      groupsByRole(stackedDark, 'symbol')
        .concat(groupsByRole(stackedDark, 'wordmark'))
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
    assertEqual(horizontalLightSymbol?.attributes.fill, '#173D39', 'light symbol color mismatch');
    assertEqual(
      horizontalDarkSymbol?.attributes.fill,
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
        manifest.originalityProvenance?.sourceReadme === SOURCE_README &&
        manifest.originalityProvenance?.sourceCommit === SOURCE_COMMIT &&
        manifest.originalityProvenance?.copyMethod
          ?.toLowerCase()
          .includes('byte-for-byte') &&
        manifest.originalityProvenance?.visualDirection?.status ===
          'OWNER_APPROVED_REFERENCE_ONLY' &&
        manifest.originalityProvenance.visualDirection.file ===
          'oorva-logo-light.png' &&
        manifest.originalityProvenance.visualDirection.sha256 ===
          '4fae9ecb3019efaf0bc1b641728a338408660b649138af922bf66e6ba4179150' &&
        manifest.originalityProvenance?.inputUse?.includes(
          'copies no PNG path',
        ) &&
        manifest.originalityProvenance.inputUse.includes('no raster trace'),
      'manifest must distinguish owner-approved visual direction from exact source-master use',
      manifest.originalityProvenance,
    );
    assertEqual(
      manifest.originalityProvenance?.sourceMasterSha256,
      SOURCE_HASHES,
      'manifest must retain exact current-main source hashes',
    );
    assertInvariant(
      typeof manifest.license?.customArtwork === 'string' &&
        manifest.license.customArtwork.length > 10 &&
        manifest.license.customArtwork.includes('D03c is NOT_APPROVED') &&
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
      'APPROVED',
      'standing D03a approval must be recorded',
    );
    assertEqual(
      manifest.approvalStatus?.D03b,
      'APPROVED',
      'standing D03b approval must be recorded',
    );
    assertEqual(
      manifest.approvalStatus?.D03bCandidateSelected,
      false,
      'O01X candidate selection must remain unrecorded until its export passes',
    );
    assertInvariant(
      manifest.approvalStatus?.D03bSelectionRule?.includes(
        'passing all A.4.1 checks',
      ) &&
        manifest.approvalStatus?.D03bCandidateEvidence?.includes(
          'O01X',
        ),
      'D03b standing approval must preserve the O01X selection rule',
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
      [],
      'fast-forward must not introduce changes in O01L-owned paths',
    );
    assertEqual(
      evidence.sourceDrift?.currentMainChangedPaths,
      [],
      'current-main source drift changed',
    );
    assertEqual(
      evidence.smallSizeEvidence?.logicalPixelChecks,
      manifest.smallSizeEvidence.logicalPixelChecks,
      'evidence small-size measurements differ from manifest',
    );
    assertNear(
      evidence.taglineContrast?.ratio,
      manifest.tagline.contrastEvidence.ratio,
      0.0000005,
      'evidence tagline contrast differs from manifest',
    );
    assertEqual(
      evidence.dropInProvenance?.sourceCommit,
      SOURCE_COMMIT,
      'evidence source commit mismatch',
    );
    assertEqual(
      evidence.dropInProvenance?.sourceReadme,
      SOURCE_README,
      'evidence source README mismatch',
    );
    assertEqual(
      evidence.dropInProvenance?.sourceReadmeSha256,
      SOURCE_README_SHA256,
      'evidence source README hash mismatch',
    );
    assertEqual(
      evidence.dropInProvenance?.sourceMasterSha256,
      SOURCE_HASHES,
      'evidence source hash inventory mismatch',
    );
    assertEqual(
      evidence.dropInProvenance?.destinationSha256,
      manifest.safeMarginCorrection?.destinationMasterSha256,
      'evidence fitted-master hash inventory mismatch',
    );
    assertEqual(
      evidence.dropInProvenance?.initialCopyByteForByteVerified,
      true,
      'evidence must confirm the initial exact source copies',
    );
    assertInvariant(
      evidence.dropInProvenance?.postCopyTransform?.includes(
        'centered uniform safe-area transform',
      ),
      'evidence must record the bounded post-copy transform',
      evidence.dropInProvenance?.postCopyTransform,
    );
    assertEqual(
      evidence.dropInProvenance?.copiedFileCount,
      9,
      'evidence must enumerate all nine drop-in masters',
    );
    assertEqual(
      evidence.validation?.codespace?.status,
      'BLOCKED_BEFORE_TEST_SELECTION',
      'Codespace authorization blocker must be recorded truthfully',
    );
    assertEqual(
      evidence.validation?.codespace?.selectedFiles,
      null,
      'Codespace selection was not reached',
    );
    assertEqual(
      evidence.validation?.codespace?.selectedCases,
      null,
      'Codespace case selection was not reached',
    );
    assertEqual(
      evidence.validation?.codespace?.typecheck,
      'NOT_RUN',
      'Codespace typecheck was not run',
    );
    assertInvariant(
      evidence.handoff?.O01X?.includes(
        'BLOCKED until this exact O01L lane head passes Lane CI',
      ),
      'O01X must remain blocked until the exact O01L head is green',
      evidence.handoff?.O01X,
    );
    assertEqual(evidence.gates?.D03a, 'APPROVED', 'evidence D03a status mismatch');
    assertEqual(evidence.gates?.D03b, 'APPROVED', 'evidence D03b status mismatch');
    assertEqual(
      evidence.gates?.D03c,
      'NOT_APPROVED',
      'evidence D03c must remain not approved',
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
      'APPROVED',
      'evidence must record standing D03b approval',
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
