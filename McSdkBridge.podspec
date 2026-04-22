Pod::Spec.new do |s|
  s.name             = 'McSdkBridge'
  s.version          = '1.0.0'
  s.summary          = 'React Native bridge for McSdk'
  s.homepage         = 'https://localhost'
  s.license          = { :type => 'MIT' }
  s.author           = { 'ASELSAN' => 'dev@aselsan.com.tr' }
  s.platform         = :ios, '13.0'
  s.source           = { :path => '.' }
  s.source_files     = 'ios/McSdkBridge/**/*.{h,m,mm}'
  s.vendored_frameworks = 'ios/McSdk.xcframework'
  s.requires_arc     = true
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_ROOT)/../ios/McSdk.xcframework/ios-arm64/Headers" "$(PODS_ROOT)/../ios/McSdk.xcframework/ios-arm64_x86_64-simulator/Headers"',
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES'
  }
  s.dependency 'React-Core'
end
