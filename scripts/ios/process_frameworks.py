#!/usr/bin/env python3
import os
import json
import hashlib
import plistlib
import subprocess
from pathlib import Path
from typing import List, Dict

def is_dynamic_library(path: Path) -> bool:
    """Check if path is a dynamic library (Mach-O or dylib)."""
    try:
        result = subprocess.run(
            ["file", str(path)],
            check=True,
            capture_output=True,
            text=True
        )
        output = result.stdout.lower()
        # Accept any dynamically linked shared library or Mach-O dylib
        return "dynamically linked shared library" in output or "mach-o" in output
    except subprocess.CalledProcessError:
        return False


def find_node_frameworks(base_path: Path):
    valid = []
    invalid_count = 0
    valid_count = 0

    for root, dirs, files in os.walk(base_path):
        # Handle .node files
        for file_name in files:
            if file_name.endswith(".node"):
                full_path = Path(root) / file_name
                if is_dynamic_library(full_path):
                    valid.append((full_path.parent, full_path.name))
                    valid_count += 1
                else:
                    print(f"Skipping {full_path}: not a dynamic library.")
                    invalid_count += 1

        # Handle .node directories (for backward compatibility)
        for dirname in dirs:
            full_path = Path(root) / dirname
            if full_path.suffix == ".node":
                contents = list(full_path.iterdir())
                if len(contents) != 1:
                    print(f"Skipping {full_path}: expected exactly one file inside.")
                    invalid_count += 1
                    continue
                bin_file = contents[0]
                if is_dynamic_library(bin_file):
                    valid.append((full_path, bin_file.name))
                    valid_count += 1
                else:
                    print(f"Skipping {full_path}: not a dynamic library.")
                    invalid_count += 1

    print(f"Found {valid_count} valid frameworks and {invalid_count} invalid frameworks.")
    return valid

def sha1_hex(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()

def generate_binary_plist(output_path: Path, bundle_name: str, env: Dict[str, str]):
    data = {
        "CFBundleIdentifier": bundle_name,
        "CFBundleExecutable": bundle_name,
        "CFBundleName": bundle_name,
        "CFBundlePackageType": "FMWK",
        "CFBundleVersion": env.get("MAC_OS_X_PRODUCT_BUILD_VERSION", "1.0"),
        "CFBundleShortVersionString": env.get("SDK_VERSION", "1.0"),
        "DTCompiler": env.get("DEFAULT_COMPILER", ""),
        "DTPlatformBuild": env.get("PLATFORM_PRODUCT_BUILD_VERSION", ""),
        "DTSDKBuild": env.get("SDK_PRODUCT_BUILD_VERSION", ""),
        "DTSDKName": env.get("SDK_NAME", ""),
        "DTXcode": env.get("XCODE_VERSION_ACTUAL", ""),
        "DTXcodeBuild": env.get("XCODE_PRODUCT_BUILD_VERSION", "")
    }
    with output_path.open("wb") as fp:
        plistlib.dump(data, fp, fmt=plistlib.FMT_BINARY)

def process_frameworks(project_path: Path):
    frameworks = find_node_frameworks(project_path)
    if not frameworks:
        print("No valid frameworks found.")
        return

    overrides = []
    preload_src = Path(__file__).parent / "override-dlopen-paths-preload.js"

    for orig_dir, bin_name in frameworks:
        rel_path = orig_dir.relative_to(project_path)
        digest = sha1_hex(str(rel_path))
        new_name = f"node{digest}"

        new_framework_dir = orig_dir.parent / f"{new_name}.framework"
        new_framework_dir.mkdir(exist_ok=True)

        # Move binary into framework directory
        old_bin_path = orig_dir / bin_name
        new_bin_path = new_framework_dir / new_name
        old_bin_path.rename(new_bin_path)

        # Create binary Info.plist
        plist_path = new_framework_dir / "Info.plist"
        generate_binary_plist(plist_path, new_name, os.environ)

        # JSON override entry
        overrides.append({
            "originalpath": list(rel_path.parts + (bin_name,)),
            "newpath": ["..", "..", "Frameworks", f"{new_name}.framework", new_name]
        })

        # Leave an empty file at the old location
        old_bin_path.touch()

    # Write override JSON
    json_path = project_path / "override-dlopen-paths-data.json"
    json_path.write_text(json.dumps(overrides, indent=2))

    # Copy preload JS
    preload_dst = project_path / "override-dlopen-paths-preload.js"
    preload_dst.write_bytes(preload_src.read_bytes())

    print("Processing complete.")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python3 process_frameworks.py <projectPath>")
        sys.exit(1)

    project = Path(sys.argv[1]).resolve()
    if not project.exists():
        print("Provided path does not exist.")
        sys.exit(1)

    process_frameworks(project)
