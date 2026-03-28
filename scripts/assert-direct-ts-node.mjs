const MIN_VERSION = [22, 18, 0];
const RUNTIME_MIN_VERSION = "22.3.0";

function parseVersion(version) {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function isAtLeast(actual, minimum) {
  for (let i = 0; i < minimum.length; i += 1) {
    if (actual[i] > minimum[i]) return true;
    if (actual[i] < minimum[i]) return false;
  }
  return true;
}

const current = parseVersion(process.versions.node);

if (!isAtLeast(current, MIN_VERSION)) {
  console.error(
    [
      "Direct TypeScript execution in this repo requires Node.js >=22.18.0.",
      "This affects `npm run dev` and `npm test`, which run `.ts` files directly with Node.",
      `The published CLI still targets Node.js >=${RUNTIME_MIN_VERSION} because it runs compiled \`dist/\` JavaScript.`,
    ].join("\n"),
  );
  process.exit(1);
}
