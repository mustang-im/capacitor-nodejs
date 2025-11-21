require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'AspectCapacitorNodejs'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['repository']['url']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.1'
  
  s.dependency 'Capacitor'
  
  # Preserve the libnode directory
  s.preserve_paths = 'ios/libnode/**/*'
  
  # Vendored frameworks from libnode
  s.vendored_frameworks = 'ios/libnode/NodeMobile.xcframework'
  
  # ⭐ Built-in script phases - CocoaPods handles everything!
  s.script_phase = {
    :name => 'Build Node.js Mobile Native Modules',
    :script => '"${PODS_TARGET_SRCROOT}/ios/scripts/rebuild-native-modules.sh"',
    :execution_position => :before_compile,
    :shell_path => '/bin/sh'
  }
  
  # For multiple phases, use script_phases (plural)
  s.script_phases = [
    {
      :name => 'Build Node.js Mobile Native Modules',
      :script => '"${PODS_TARGET_SRCROOT}/ios/scripts/rebuild-native-modules.sh"',
      :execution_position => :before_compile
    },
    {
      :name => 'Sign Node.js Mobile Native Modules',
      :script => '"${PODS_TARGET_SRCROOT}/ios/scripts/sign-native-modules.sh"',
      :execution_position => :after_compile
    }
  ]
end
