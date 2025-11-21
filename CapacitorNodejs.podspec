require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapacitorNodejs'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['repository']['url']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.resources = 'ios/Plugin/builtin_modules/**/*'
  s.ios.deployment_target = '12.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'

  # Link against NodeMobile framework
  # The framework is at ios/libnode/NodeMobile.xcframework (relative to podspec location)
  # The framework is downloaded by the capacitor:sync:before hook before pod install runs
  s.vendored_frameworks = 'ios/libnode/NodeMobile.xcframework'
  s.pod_target_xcconfig = {
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/ios/libnode"',
    'OTHER_LDFLAGS' => '$(inherited) -framework "NodeMobile"'
  }
end
