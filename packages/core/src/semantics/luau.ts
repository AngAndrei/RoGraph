import type { Expr, Facts } from "../../../contracts/src/model.js";
const members: Record<string, Set<string>> = Object.fromEntries(
  Object.entries({
    math: "abs acos asin atan atan2 ceil clamp cos cosh deg exp floor fmod frexp ldexp log log10 max min modf noise pow rad random randomseed round sign sin sinh sqrt tan tanh huge pi",
    string:
      "byte char find format gmatch gsub len lower match pack packsize rep reverse split sub unpack upper",
    table:
      "clear clone concat create find freeze insert isfrozen maxn move pack remove sort unpack",
    task: "spawn defer delay wait cancel synchronize desynchronize",
    coroutine: "close create isyieldable resume running status wrap yield",
    CFrame:
      "new Angles fromAxisAngle fromEulerAnglesXYZ fromEulerAnglesYXZ fromMatrix fromOrientation lookAt lookAlong identity",
    Vector3: "new FromAxis FromNormalId zero one xAxis yAxis zAxis",
    Vector2: "new zero one",
    Color3: "new fromRGB fromHSV fromHex",
    UDim: "new",
    UDim2: "new fromOffset fromScale",
    Instance: "new",
    os: "clock date difftime time",
    utf8: "char charpattern codepoint codes graphemes len nfcnormalize nfdnormalize offset",
    bit32:
      "arshift band bnot bor btest bxor countlz countrz extract lrotate lshift replace rrotate rshift",
    buffer:
      "create fromstring tostring len readi8 readu8 readi16 readu16 readi32 readu32 readf32 readf64 writei8 writeu8 writei16 writeu16 writei32 writeu32 writef32 writef64 readstring writestring copy fill",
  }).map(([name, list]) => [name, new Set(list.split(" "))]),
);
const bindingsByFacts = new WeakMap<
  Facts,
  Map<string, Facts["bindings"][number]>
>();
const overwrittenByFacts = new WeakMap<Facts, Set<string>>();
function path(e: Expr | undefined, f: Facts, depth = 0): string | undefined {
  if (!e || depth > 16) return;
  if (e.kind === "global") return String(e.name);
  if (e.kind === "binding")
    return path(
      bindingsByFacts.get(f)?.get(String(e.bindingId))?.initializer,
      f,
      depth + 1,
    );
  if (e.kind === "index" && (e.key as Expr)?.kind === "literal") {
    const base = path(e.base as Expr, f, depth + 1);
    return base ? base + "." + String((e.key as Expr).value) : undefined;
  }
}
export function platformMember(
  root: string,
  key: string | number,
  f: Facts,
): string | undefined {
  const name = root.split(".")[0];
  let overwritten = overwrittenByFacts.get(f);
  if (!overwritten) {
    bindingsByFacts.set(f, new Map(f.bindings.map((b) => [b.id, b])));
    overwritten = new Set<string>();
    for (const m of (f.members as any[]) ?? []) {
      const target = path(m.target.base, f);
      if (target) overwritten.add(target.split(".")[0]);
    }
    overwrittenByFacts.set(f, overwritten);
  }
  if (overwritten.has(name)) return;
  return name === "Enum" || members[root]?.has(String(key))
    ? root + "." + key
    : undefined;
}
export function platformResult(path: string): {
  kind: string;
  [key: string]: unknown;
} {
  if (path === "math.pi") return { kind: "literal", value: Math.PI };
  if (path === "math.huge") return { kind: "scalar", type: "number" };
  return {
    kind: "scalar",
    type: path.startsWith("math.") ? "number" : path.split(".")[0],
    platform: path,
  };
}
