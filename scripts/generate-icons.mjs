import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";

const sizes = [16, 32, 48, 128];
const variants = [
  { name: "icon", svg: "public/icon.svg" },
  { name: "icon-active", svg: "public/icon-active.svg" },
];
const outDir = "public/icons";

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// Try rsvg-convert first (best quality), fallback to sips
let converter = "none";
try {
  execSync("which rsvg-convert", { stdio: "pipe" });
  converter = "rsvg";
} catch {
  try {
    execSync("which sips", { stdio: "pipe" });
    converter = "sips";
  } catch {
    console.error("No SVG converter found. Install librsvg (brew install librsvg) or use macOS.");
    process.exit(1);
  }
}

for (const { name, svg } of variants) {
  if (!existsSync(svg)) {
    console.error(`SVG not found: ${svg}`);
    continue;
  }

  for (const size of sizes) {
    const outFile = `${outDir}/${name}-${size}.png`;

    if (converter === "rsvg") {
      execSync(`rsvg-convert -w ${size} -h ${size} ${svg} -o ${outFile}`);
    } else {
      // sips can't convert SVG directly, use python3 with cairosvg or Pillow
      execSync(
        `python3 -c "
import subprocess, sys
try:
    import cairosvg
    cairosvg.svg2png(url='${svg}', write_to='${outFile}', output_width=${size}, output_height=${size})
except ImportError:
    try:
        from PIL import Image
        import io
        # Fallback: use sips to convert SVG to PNG at base size, then resize
        subprocess.run(['qlmanage', '-t', '-s', '${size}', '-o', '/tmp', '${svg}'], capture_output=True)
        import shutil
        shutil.copy('/tmp/${svg.split("/").pop()}.png', '${outFile}')
    except Exception as e:
        print(f'Failed: {e}', file=sys.stderr)
        sys.exit(1)
" 2>/dev/null`
      );
    }
    console.log(`Generated: ${outFile} (${size}x${size})`);
  }
}

console.log("Done generating icons.");
