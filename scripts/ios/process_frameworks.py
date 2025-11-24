#!/usr/bin/env python3
import os
import json
import hashlib
import plistlib
import subprocess
from pathlib import Path
from typing import List, Dict


def is_dynamic_library(path: Path) -> bool:
    # For iOS builds, consider all .node files valid
    return path.suffix == ".node" and path.is_file()


def find_node_binaries(base_path: Path):
    """Find all .node files (or directories containing a single binary) to convert into frameworks."""
    binaries = []
    for root, dirs, files in os.walk(base_path):
        for filename in files:
            if filename.endswith(".node"):
                full_path = Path(root) / filename
                if is_dynamic_library(full_path):
                    binaries.append(full_path)
                else:
                    print(f"Skipping {full_path}: not a dynamic library.")
    return binaries


def sha1_hex(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def generate_binary_plist(output_path: Path, bundle_name: str, env: Dict[str, str]):
    """Generate a binary Info.plist using plistlib."""
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
    binaries = find_node_binaries(project_path)
    if not binaries:
        print("No valid .node binaries found.")
        return

    overrides = []
    preload_src = Path(__file__).parent / "override-dlopen-paths-preload.js"

    for node_file in binaries:
        rel_path = node_file.relative_to(project_path)
        digest = sha1_hex(str(node_file))
        new_name = f"node{digest}"

        # Create framework directory
        new_framework_dir = node_file.parent / f"{new_name}.framework"
        new_framework_dir.mkdir(exist_ok=True)

        # Move the .node file into the framework
        new_bin_path = new_framework_dir / new_name
        node_file.rename(new_bin_path)

        # Create Info.plist
        plist_path = new_framework_dir / "Info.plist"
        generate_binary_plist(plist_path, new_name, os.environ)

        # JSON override entry
        overrides.append({
            "originalpath": list(rel_path.parts),
            "newpath": ["..", "..", "Frameworks", f"{new_name}.framework", new_name]
        })

        # Leave empty file at old location
        node_file.touch()

    # Write override JSON
    json_path = project_path / "override-dlopen-paths-data.json"
    json_path.write_text(json.dumps(overrides, indent=2))

    # Copy preload JS
    preload_dst = project_path / "override-dlopen-paths-preload.js"
    preload_dst.write_bytes(preload_src.read_bytes())

    print(f"Processed {len(binaries)} .node binaries into frameworks.")


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
