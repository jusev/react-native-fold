require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RNFold"
  s.version      = package["version"]
  s.license      = package["license"]
  s.summary      = package["description"]
  s.author       = package["author"]
  s.homepage     = package["homepage"]
  s.platforms    = { :ios => "15.1" }
  s.requires_arc = true
  s.source       = { :git => "https://github.com/jusev/react-native-fold.git", :commit => "963deee1ca" }
  s.source_files = "ios/**/*.{h,m,mm}"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }

  install_modules_dependencies(s)
end
