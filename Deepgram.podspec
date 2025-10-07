require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Deepgram"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/itsRares/react-native-deepgram.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/*.{h,m,mm,cpp}",
    "ios/generated/build/generated/ios/DeepgramSpec/**/*.{h,mm,cpp}",
    "ios/generated/build/generated/ios/DeepgramSpec*.*"
  ]
  s.private_header_files = "ios/**/*.h"
  s.frameworks = ["AVFoundation", "AVFAudio"]


  install_modules_dependencies(s)
end
