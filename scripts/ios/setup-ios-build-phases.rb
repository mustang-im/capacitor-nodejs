#!/usr/bin/env ruby

require 'rbconfig'
require 'fileutils'

# --- 1) Check platform ---
unless RbConfig::CONFIG['host_os'] =~ /darwin/
  puts "ℹ️  Skipping iOS setup (not on macOS)"
  exit 0
end

# --- 2) Ensure xcodeproj gem is installed ---
def ensure_xcodeproj
  begin
    require 'xcodeproj'
  rescue LoadError
    puts "📦 Installing xcodeproj gem…"
    install_cmd = "gem install xcodeproj --user-install"
    success = system(install_cmd)
    unless success
      puts "❌ Failed to install xcodeproj"
      puts "   Install manually: gem install xcodeproj"
      exit 1
    end
    require 'xcodeproj'
  end
end

ensure_xcodeproj
require 'xcodeproj'

SCRIPT_DIR = File.dirname(File.realpath(__FILE__))

# --- 3) Locate .xcodeproj ---
def find_xcodeproj
  search_paths = [
    File.join(SCRIPT_DIR, "../../../../ios/App/*.xcodeproj"),
    File.join(SCRIPT_DIR, "../../../../ios/*.xcodeproj")
  ]
  search_paths.each do |pattern|
    matches = Dir.glob(pattern)
    return matches.first if matches.any?
  end
  nil
end

xcodeproj_path = ARGV[0] || find_xcodeproj

unless xcodeproj_path && File.exist?(xcodeproj_path)
  puts "❌ Could not find .xcodeproj"
  puts "   Run: npx cap add ios"
  exit 1
end

puts "Found project: #{xcodeproj_path}"

# --- 4) Backup project ---
backup_path = "#{xcodeproj_path}.backup-#{Time.now.to_i}"
FileUtils.cp_r(xcodeproj_path, backup_path)
puts "Created backup: #{backup_path}"

begin
  project = Xcodeproj::Project.open(xcodeproj_path)

  target = project.targets.find { |t| t.product_type == "com.apple.product-type.application" }
  raise "App target not found" unless target

  # Correct relative path from $SRCROOT
  relative_scripts_base = "../../node_modules/capacitor-nodejs/scripts/ios"

  def add_phase(target, name, script_relative_path)
    existing = target.shell_script_build_phases.find { |p| p.name == name }

    # One-liner: run script from $SRCROOT
    new_script = "\"$SRCROOT/#{script_relative_path}\""

    if existing
      puts "Updating existing build phase: #{name}"
      existing.shell_script = new_script
    else
      puts "Adding new build phase: #{name}"
      phase = target.new_shell_script_build_phase(name)
      phase.shell_script = new_script
    end
  end

  add_phase(target, "Build Node.js Mobile Native Modules", "#{relative_scripts_base}/rebuild-native-modules.sh")
  add_phase(target, "Sign Node.js Mobile Native Modules", "#{relative_scripts_base}/sign-native-modules.sh")

  project.save
  puts "✅ Build phases configured successfully"

  FileUtils.rm_rf(backup_path)

rescue => e
  puts "❌ Error: #{e.message}"
  FileUtils.rm_rf(xcodeproj_path)
  FileUtils.cp_r(backup_path, xcodeproj_path)
  puts "⚠️ Restored original project"
  exit 1
end
