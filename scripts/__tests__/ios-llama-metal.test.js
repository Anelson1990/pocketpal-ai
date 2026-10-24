const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LLAMA_RN = path.join(ROOT, 'node_modules', 'llama.rn');
const GGML_METAL = path.join(
  LLAMA_RN,
  'vendor',
  'llama.cpp',
  'ggml',
  'src',
  'ggml-metal',
);
const WHISPER_CPP = path.join(ROOT, 'node_modules', 'whisper.rn', 'cpp');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf-8');

const appDelegate = read('ios/PocketPal/AppDelegate.swift');
const metalGate = read('ios/PocketPal/LlamaMetalGate.swift');
const podfile = read('ios/Podfile');
const pbxproj = read('ios/PocketPal.xcodeproj/project.pbxproj');
const metallibScript = read('scripts/build-ios-metallib.sh');
const deviceCapabilities = read('src/utils/deviceCapabilities.ts');
const podspec = fs.readFileSync(
  path.join(LLAMA_RN, 'llama-rn.podspec'),
  'utf-8',
);
const whisperPodspec = fs.readFileSync(
  path.join(ROOT, 'node_modules', 'whisper.rn', 'whisper-rn.podspec'),
  'utf-8',
);
const metalDevice = fs.readFileSync(
  path.join(GGML_METAL, 'ggml-metal-device.m'),
  'utf-8',
);

const parseKernelSet = (source, macro) =>
  [
    ...(source.match(
      new RegExp(`^#define ${macro}((?:.*\\\\\\n)+.*)`, 'm'),
    ) || ['', ''])[1].matchAll(/X\(\s*\w+\s*,\s*(\w+)\s*\)/g),
  ].map(match => match[1]);
const listKernelFiles = metalDir =>
  fs
    .readdirSync(path.join(metalDir, 'kernels'), {withFileTypes: true})
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();

const kernelSet = parseKernelSet(metalDevice, 'GGML_METAL_LIBS');
const kernelFiles = listKernelFiles(GGML_METAL);
const whisperKernelSet = parseKernelSet(
  fs.readFileSync(
    path.join(WHISPER_CPP, 'ggml-metal', 'ggml-metal-device.m'),
    'utf-8',
  ),
  'WSP_GGML_METAL_LIBS',
);
const whisperKernelFiles = listKernelFiles(
  path.join(WHISPER_CPP, 'ggml-metal'),
);

const parsePhase = library => {
  const match = pbxproj.match(
    new RegExp(
      `/\\* \\[CP-User\\] Build ${library.replace('.', '\\.')} Metal kernels \\*/ = \\{([\\s\\S]*?)\\n\\t\\t\\};`,
    ),
  );
  if (!match) {
    return null;
  }
  const list = key =>
    [
      ...(match[1].match(new RegExp(`${key} = \\(([\\s\\S]*?)\\);`)) || [
        '',
        '',
      ])[1].matchAll(/"([^"]+)"/g),
    ].map(m => m[1]);
  const script = match[1].match(/shellScript = "((?:[^"\\]|\\.)*)";/);
  return {
    inputs: list('inputPaths'),
    outputs: list('outputPaths'),
    script: script ? script[1].replace(/\\"/g, '"') : '',
  };
};
const metalPhase = parsePhase('llama.rn');
const whisperPhase = parsePhase('whisper.rn');

const APP_RESOURCES =
  '$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)';

describe('the parse itself', () => {
  it('finds the kernel set in the vendored ggml', () => {
    expect(kernelSet.length).toBeGreaterThan(0);
    expect(kernelFiles.length).toBeGreaterThan(kernelSet.length);
  });

  it('finds the whisper.rn kernel set in its ggml', () => {
    expect(whisperKernelSet).toHaveLength(20);
    expect(whisperKernelFiles.length).toBeGreaterThan(whisperKernelSet.length);
  });

  it.each([
    ['llama.rn', metalPhase],
    ['whisper.rn', whisperPhase],
  ])('finds the %s Metal kernel phase in the app project', (_, phase) => {
    expect(phase).not.toBeNull();
    expect(phase.inputs.length).toBeGreaterThan(0);
    expect(phase.outputs.length).toBeGreaterThan(0);
  });
});

describe('the parsed kernel set', () => {
  it('is every kernel source that no other kernel includes', () => {
    const included = new Set(
      kernelFiles.flatMap(name =>
        [
          ...fs
            .readFileSync(path.join(GGML_METAL, 'kernels', name), 'utf-8')
            .matchAll(/#include\s+"([^"]+\.metal)"/g),
        ].map(match => match[1]),
      ),
    );
    const entryPoints = kernelFiles
      .filter(name => name.endsWith('.metal') && !included.has(name))
      .map(name => name.replace(/\.metal$/, ''));
    expect(included.size).toBeGreaterThan(0);
    expect([...kernelSet].sort()).toEqual(entryPoints);
  });

  it('is every whisper.rn kernel source', () => {
    expect([...whisperKernelSet].sort()).toEqual(
      whisperKernelFiles
        .filter(name => name.endsWith('.metal'))
        .map(name => name.replace(/\.metal$/, '')),
    );
  });
});

describe('the iOS version the Metal library and its gates agree on', () => {
  const versions = {
    appDelegate: appDelegate.match(/#available\(iOS (\d+)\.0, \*\)/),
    metallibTarget: metallibScript.match(/-mtargetos=ios(\d+)\.0/),
    jsGpuPolicy: deviceCapabilities.match(/iosVersion >= (\d+)/),
  };

  it('is found in each place', () => {
    for (const match of Object.values(versions)) {
      expect(match).not.toBeNull();
    }
  });

  it('is the same major version in each place', () => {
    const majors = new Set(
      Object.values(versions).map(match => match && match[1]),
    );
    expect([...majors]).toEqual(['18']);
  });
});

describe('the launch-time Metal gate', () => {
  const launchBody = appDelegate.match(
    /didFinishLaunchingWithOptions[^{]*\{\s*([^\n]+)/,
  );

  it('runs before anything else at launch', () => {
    expect(launchBody).not.toBeNull();
    expect(launchBody[1].trim()).toBe('configureGgmlMetal()');
  });

  it('turns llama.rn Metal off through the env ggml reads', () => {
    expect(appDelegate).toMatch(
      /disablesLlamaMetal\([^)]*\)\s*\{\s*setenv\("GGML_METAL_DEVICES", "0", 1\)/,
    );
  });

  it('reads the iOS version, not the host OS version', () => {
    expect(appDelegate).not.toMatch(/operatingSystemVersion/);
  });
});

describe('the Metal gate logic', () => {
  const predicate = metalGate.match(
    /func disablesLlamaMetal\(iOS18OrLater: Bool, supportsApple6: Bool\) -> Bool \{\s*([^}]*?)\s*\}/,
  );
  const launchGate = appDelegate.match(
    /func configureGgmlMetal\(\) \{([\s\S]*?)\n {2}\}/,
  );

  it('finds the predicate and the launch gate', () => {
    expect(predicate).not.toBeNull();
    expect(launchGate).not.toBeNull();
  });

  it.each([
    [false, true, true],
    [false, false, true],
    [true, false, true],
    [true, true, false],
  ])(
    'with iOS18OrLater %s and supportsApple6 %s, disables Metal: %s',
    (iOS18OrLater, supportsApple6, disables) => {
      const body = predicate[1];
      expect(body).toMatch(
        /^[\s!|&()]*(?:(?:iOS18OrLater|supportsApple6)[\s!|&()]*)+$/,
      );
      expect(vm.runInNewContext(body, {iOS18OrLater, supportsApple6})).toBe(
        disables,
      );
    },
  );

  it("is only whisper's tensor opt-out, the iOS check, the Apple6 probe on iOS 18 and later, and the setenvs", () => {
    expect(launchGate[1].trim().split(/\s*\n\s*/)).toEqual([
      'setenv("WSP_GGML_METAL_TENSOR_DISABLE", "1", 1)',
      'var iOS18OrLater = false',
      'if #available(iOS 18.0, *) {',
      'iOS18OrLater = true',
      '}',
      'let supportsApple6 = iOS18OrLater && (MTLCreateSystemDefaultDevice()?.supportsFamily(.apple6) ?? false)',
      'if disablesLlamaMetal(iOS18OrLater: iOS18OrLater, supportsApple6: supportsApple6) {',
      'setenv("GGML_METAL_DEVICES", "0", 1)',
      'setenv("WSP_GGML_METAL_DEVICES", "0", 1)',
      '}',
    ]);
  });
});

describe('the llama.rn build mode', () => {
  it('is set to from-source at the Podfile top level, before any target', () => {
    const setAt = podfile.search(/^ENV\['RNLLAMA_BUILD_FROM_SOURCE'\] = '1'$/m);
    expect(setAt).toBeGreaterThanOrEqual(0);
    expect(setAt).toBeLessThan(podfile.search(/^target /m));
  });

  it('is set nowhere else, and no build sets llama.rn CPU or Metal opt-outs', () => {
    const files = [
      'package.json',
      'ios/fastlane/Fastfile',
      ...fs
        .readdirSync(path.join(ROOT, '.github', 'workflows'))
        .map(name => `.github/workflows/${name}`),
      ...fs
        .readdirSync(path.join(ROOT, 'scripts'))
        .filter(name => name.endsWith('.sh'))
        .map(name => `scripts/${name}`),
    ];
    const offenders = files.filter(file =>
      /RNLLAMA_(BUILD_FROM_SOURCE|NATIVE_CPU|DISABLE_METAL)/.test(read(file)),
    );
    expect(offenders).toEqual([]);
    expect(podfile).not.toMatch(/RNLLAMA_(NATIVE_CPU|DISABLE_METAL)/);
  });
});

describe('the whisper.rn build mode', () => {
  it('is set to from-source at the Podfile top level, before any target, and nowhere else in it', () => {
    const setAt = podfile.search(
      /^ENV\['RNWHISPER_BUILD_FROM_SOURCE'\] = '1'$/m,
    );
    expect(setAt).toBeGreaterThanOrEqual(0);
    expect(setAt).toBeLessThan(podfile.search(/^target /m));
    expect(podfile.match(/RNWHISPER_BUILD_FROM_SOURCE/g)).toHaveLength(1);
  });

  it('is set nowhere else, and no build turns whisper.rn Metal off', () => {
    const files = [
      'package.json',
      'ios/fastlane/Fastfile',
      ...fs
        .readdirSync(path.join(ROOT, '.github', 'workflows'))
        .map(name => `.github/workflows/${name}`),
      ...fs
        .readdirSync(path.join(ROOT, 'scripts'))
        .filter(name => name.endsWith('.sh'))
        .map(name => `scripts/${name}`),
    ];
    const offenders = files.filter(file =>
      /RNWHISPER_(BUILD_FROM_SOURCE|DISABLE_METAL)/.test(read(file)),
    );
    expect(offenders).toEqual([]);
    expect(podfile).not.toMatch(/RNWHISPER_DISABLE_METAL/);
  });
});

describe('the patched llama.rn Metal lookup', () => {
  it('builds Metal without the embedded kernel library', () => {
    expect(podspec).not.toMatch(/-DGGML_METAL_EMBED_LIBRARY/);
    expect(podspec).toMatch(/-DGGML_USE_METAL\b/);
    expect(podspec).toMatch(/-DGGMLMetalClass=RNLlamaGGMLMetalClass\b/);
  });

  it('compiles no embedded-kernel assembly from ggml-metal', () => {
    const globs = [...podspec.matchAll(/"[^"]*ggml-metal\/\*\.\{([^}]*)\}"/g)];
    expect(globs.length).toBeGreaterThan(0);
    for (const [, extensions] of globs) {
      expect(extensions.split(',')).not.toContain('s');
    }
  });

  it('looks up rnllama.metallib, never default.metallib', () => {
    expect(metalDevice).toMatch(
      /ggml_metal_find_metallib\(bundle, @"rnllama"\)/,
    );
    expect(metalDevice).not.toMatch(
      /ggml_metal_find_metallib\(bundle, @"default"\)/,
    );
  });

  it('logs the kernel-source fallback without naming a library file', () => {
    expect(metalDevice).toMatch(
      /GGML_LOG_INFO\("%s: no precompiled metallib, loading kernel sources\\n"/,
    );
  });

  it('skips the precompiled library on tensor GPUs', () => {
    expect(metalDevice).toMatch(
      /if \(ggml_metal_device_get_props\(dev\)->has_tensor\) \{\s*GGML_LOG_INFO\([^;]*\);\s*\} else \{\s*path_lib = ggml_metal_find_metallib\(bundle, @"rnllama"\);\s*\}/,
    );
  });
});

describe('the committed Metal kernel phase', () => {
  it('compiles exactly the vendored kernel set, in order', () => {
    const args = metalPhase.script.trim().split(/\s+/);
    expect(args.slice(0, 2)).toEqual([
      '"${SRCROOT}/../scripts/build-ios-metallib.sh"',
      '"${SRCROOT}/../node_modules/llama.rn/vendor/llama.cpp/ggml/src"',
    ]);
    expect(args.slice(2)).toEqual(kernelSet);
  });

  it('declares every vendored kernel file and both headers as inputs', () => {
    const prefix =
      '$(SRCROOT)/../node_modules/llama.rn/vendor/llama.cpp/ggml/src';
    expect(metalPhase.inputs).toEqual([
      ...kernelFiles.map(name => `${prefix}/ggml-metal/kernels/${name}`),
      `${prefix}/ggml-metal/ggml-metal-impl.h`,
      `${prefix}/ggml-common.h`,
      '$(SRCROOT)/../scripts/build-ios-metallib.sh',
    ]);
  });

  it('writes rnllama.metallib, the kernel sources and both headers, and no other library', () => {
    expect(metalPhase.outputs).toEqual([
      `${APP_RESOURCES}/rnllama.metallib`,
      ...kernelFiles.map(name => `${APP_RESOURCES}/kernels/${name}`),
      `${APP_RESOURCES}/ggml-metal-impl.h`,
      `${APP_RESOURCES}/ggml-common.h`,
    ]);
  });

  it('is the only writer of those files in the app project', () => {
    const phases = pbxproj.match(/Build llama\.rn Metal kernels \*\/ = \{/g);
    expect(phases).toHaveLength(1);
    expect(pbxproj.match(/rnllama\.metallib/g)).toHaveLength(1);
    expect(pbxproj).not.toMatch(/\.metal in (Sources|Resources)/);
  });
});

describe('the committed whisper.rn Metal kernel phase', () => {
  it('compiles exactly the whisper.rn kernel set, in order', () => {
    const args = whisperPhase.script.trim().split(/\s+/);
    expect(args.slice(0, 3)).toEqual([
      '"${SRCROOT}/../scripts/build-ios-metallib.sh"',
      '--whisper',
      '"${SRCROOT}/../node_modules/whisper.rn/cpp"',
    ]);
    expect(args.slice(3)).toEqual(whisperKernelSet);
  });

  it('declares every whisper.rn kernel file and both headers as inputs', () => {
    const prefix = '$(SRCROOT)/../node_modules/whisper.rn/cpp';
    expect(whisperPhase.inputs).toEqual([
      ...whisperKernelFiles.map(name => `${prefix}/ggml-metal/kernels/${name}`),
      `${prefix}/ggml-metal/ggml-metal-impl.h`,
      `${prefix}/ggml-common.h`,
      '$(SRCROOT)/../scripts/build-ios-metallib.sh',
    ]);
  });

  it('writes only default.metallib', () => {
    expect(whisperPhase.outputs).toEqual([`${APP_RESOURCES}/default.metallib`]);
  });

  it('is the only writer of default.metallib in the app project', () => {
    const phases = pbxproj.match(/Build whisper\.rn Metal kernels \*\/ = \{/g);
    expect(phases).toHaveLength(1);
    expect(pbxproj.match(/default\.metallib/g)).toHaveLength(1);
  });
});

describe('the app project settings pod install writes', () => {
  it('builds simulator slices arm64-only in every project configuration', () => {
    const list = pbxproj.match(
      /\/\* Build configuration list for PBXProject "PocketPal" \*\/ = \{\s*isa = XCConfigurationList;\s*buildConfigurations = \(([\s\S]*?)\);/,
    );
    expect(list).not.toBeNull();
    const configs = [...list[1].matchAll(/([0-9A-F]{24}) \/\* (\w+) \*\//g)];
    expect(configs.map(([, , name]) => name).sort()).toEqual([
      'Debug',
      'Profiling',
      'Release',
    ]);
    for (const [, id] of configs) {
      const settings = pbxproj.match(
        new RegExp(
          `\\t${id} /\\* \\w+ \\*/ = \\{\\s*isa = XCBuildConfiguration;[^{]*buildSettings = \\{([\\s\\S]*?)\\n\\t\\t\\t\\};`,
        ),
      );
      expect(settings).not.toBeNull();
      expect(settings[1]).toMatch(
        /"EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]" = x86_64;/,
      );
    }
  });

  it("gives only the App Intents wrapper llama.rn's headers, common/ before ggml-cpu/", () => {
    const flagged = [
      ...pbxproj.matchAll(
        /\/\* (\S+) in Sources \*\/ = \{[^\n]*COMPILER_FLAGS = "((?:[^"\\]|\\.)*)"/g,
      ),
    ];
    expect(flagged.map(([, file]) => file)).toEqual(['LlamaContextWrapper.mm']);
    const includes = [...flagged[0][2].matchAll(/-I\\"([^\\]+)\\"/g)].map(
      match => match[1],
    );
    const llamaCpp = '$(SRCROOT)/../node_modules/llama.rn/vendor/llama.cpp';
    expect(includes[0]).toBe('$(SRCROOT)/../node_modules/llama.rn/cpp');
    expect(includes.indexOf(`${llamaCpp}/common`)).toBeGreaterThan(-1);
    expect(includes.indexOf(`${llamaCpp}/common`)).toBeLessThan(
      includes.indexOf(`${llamaCpp}/ggml/src/ggml-cpu`),
    );
    expect(flagged[0][2]).not.toMatch(/\/Users\/|\/home\//);
  });
});

describe('ggml header resolution in the llama-rn and whisper-rn pods', () => {
  const helper = podfile.match(
    /^def resolve_ggml_headers_by_search_path\(installer\)\n([\s\S]*?)^end$/m,
  );
  const postInstall = podfile.match(
    /post_install do \|installer\|([\s\S]*?)\n {2}end/,
  );

  it('finds the helper and post_install', () => {
    expect(helper).not.toBeNull();
    expect(postInstall).not.toBeNull();
  });

  it('turns header maps off in every configuration of exactly the two ggml pods', () => {
    const targets = [...helper[1].matchAll(/^ {4}'([\w-]+)' => \[/gm)].map(
      match => match[1],
    );
    expect(targets).toEqual(['llama-rn', 'whisper-rn']);
    expect(helper[1]).toMatch(
      /target\.build_configurations\.each do \|config\|\s*config\.build_settings\['USE_HEADERMAP'\] = 'NO'/,
    );
    expect(helper[1]).toMatch(
      /raise Pod::Informative, "#\{name\} pod target not found"/,
    );
    expect(postInstall[1]).toMatch(
      /^\s*resolve_ggml_headers_by_search_path\(installer\)$/m,
    );
  });

  it('gives llama-rn the two directories only its header map supplied, after the inherited ones', () => {
    expect(helper[1]).toContain(
      `'"$(PODS_TARGET_SRCROOT)/vendor/llama.cpp/vendor/nlohmann"'`,
    );
    expect(helper[1]).toMatch(
      /create_header_search_path_for_frameworks\(\s*'PODS_CONFIGURATION_BUILD_DIR', 'ReactCodegen', 'ReactCodegen', \['RNLlamaSpec'\], false,\s*\)/,
    );
    expect(helper[1]).toMatch(
      /Array\(config\.build_settings\['HEADER_SEARCH_PATHS'\] \|\| '\$\(inherited\)'\)/,
    );
  });

  it("lists whisper.rn's include directories in its from-source podspec", () => {
    const fromSource = whisperPodspec.match(
      /if ENV\["RNWHISPER_BUILD_FROM_SOURCE"\] == "1"([\s\S]*?)\n {2}else/,
    );
    expect(fromSource).not.toBeNull();
    expect(fromSource[1]).toContain(
      '["cpp", "cpp/ggml-cpu", "cpp/coreml", "cpp/jsi"].each { |dir| header_search_paths << "\\"$(PODS_TARGET_SRCROOT)/#{dir}\\"" }',
    );
  });
});
