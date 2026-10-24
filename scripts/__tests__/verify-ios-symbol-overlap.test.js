const {spawnSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'verify-ios-symbol-overlap.sh');

const DEMANGLED = {
  _ZNSt3__16vectorIiNS_9allocatorIiEEED2Ev:
    'std::__1::vector<int, std::__1::allocator<int> >::~vector()',
  _ZN8facebook3jsi5ValueD2Ev: 'facebook::jsi::Value::~Value()',
  _ZN8facebook5react11CallInvokerD2Ev:
    'facebook::react::CallInvoker::~CallInvoker()',
  _ZN10ThreadPoolC2Em: 'ThreadPool::ThreadPool(unsigned long)',
  _ZTVN4ggml3cpu17extra_buffer_typeE: 'vtable for ggml::cpu::extra_buffer_type',
  _ZN4ggml3cpu17extra_buffer_typeD2Ev:
    'ggml::cpu::extra_buffer_type::~extra_buffer_type()',
  _Z15dl_load_libraryRKNSt3__14__fs10filesystem4pathE:
    'dl_load_library(std::__1::__fs::filesystem::path const&)',
  _ZNSt3__16vectorIP11ggml_tensorNS_9allocatorIS2_EEED2Ev:
    'std::__1::vector<ggml_tensor*, std::__1::allocator<ggml_tensor*> >::~vector()',
  _ZNSt3__110unique_ptrIv17dl_handle_deleterE5resetEPv:
    'std::__1::unique_ptr<void, dl_handle_deleter>::reset(void*)',
  _ZN6pocket6helperEv: 'pocket::helper()',
};

const sym = (address, binding, name, section = '(__TEXT,__text)') =>
  `${address} ${section} ${binding} ${name}`;

const STD = sym(
  '0000000000000000',
  'weak private external',
  '__ZNSt3__16vectorIiNS_9allocatorIiEEED2Ev',
);
const JSI = sym(
  '0000000000000040',
  'weak private external',
  '__ZN8facebook3jsi5ValueD2Ev',
);
const REACT = sym(
  '0000000000000060',
  'weak private external',
  '__ZN8facebook5react11CallInvokerD2Ev',
);
const TERMINATE = sym(
  '0000000000000080',
  'weak private external',
  '___clang_call_terminate',
);
const THREAD_POOL = sym(
  '00000000000000c0',
  'private external',
  '__ZN10ThreadPoolC2Em',
);
const GGML_VTABLE = sym(
  '0000000000000100',
  'weak private external',
  '__ZTVN4ggml3cpu17extra_buffer_typeE',
  '(__DATA,__const)',
);
const GGML_DTOR = sym(
  '0000000000000140',
  'private external',
  '__ZN4ggml3cpu17extra_buffer_typeD2Ev',
);
const DL_LOAD = sym(
  '0000000000000180',
  'private external',
  '__Z15dl_load_libraryRKNSt3__14__fs10filesystem4pathE',
);
const STD_OVER_GGML = sym(
  '00000000000001c0',
  'weak private external',
  '__ZNSt3__16vectorIP11ggml_tensorNS_9allocatorIS2_EEED2Ev',
);
const STD_OVER_DL = sym(
  '0000000000000200',
  'weak private external',
  '__ZNSt3__110unique_ptrIv17dl_handle_deleterE5resetEPv',
);
const OWN_A = sym('0000000000000240', 'external', '_rnllama_only');
const OWN_B = sym('0000000000000240', 'external', '_rnwhisper_only');

const archive = (name, members) =>
  members
    .map(([member, lines]) => `\n${name}(${member}):\n${lines.join('\n')}\n`)
    .join('');

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-ios-symbol-overlap-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'nm'),
    `#!/bin/bash
[ "$1 $2" = "-m -U" ] || { echo "stub nm: unexpected flags $*" >&2; exit 2; }
[ -n "\${STUB_NM_FAIL:-}" ] && exit 1
cat "$3.nm"
`,
    {mode: 0o755},
  );
  fs.writeFileSync(
    path.join(bin, 'c++filt'),
    `#!/bin/bash
[ "$*" = -n ] || { echo "stub c++filt: expected only -n, got $*" >&2; exit 2; }
awk -F '\\t' 'FILENAME == ARGV[1] { map[$1] = $2; next } { print ($0 in map) ? map[$0] : $0 }' "$STUB_CXXFILT_MAP" -
`,
    {mode: 0o755},
  );
  fs.writeFileSync(
    path.join(tmp, 'cxxfilt.map'),
    Object.entries(DEMANGLED)
      .map(([mangled, demangled]) => `${mangled}\t${demangled}`)
      .join('\n') + '\n',
  );
});

afterEach(() => {
  fs.rmSync(tmp, {recursive: true, force: true});
});

function run(aLines, bLines, {env = {}, args} = {}) {
  const a = path.join(tmp, 'libllama-rn.a');
  const b = path.join(tmp, 'libwhisper-rn.a');
  fs.writeFileSync(`${a}.nm`, archive(a, [['rn-llama.o', aLines]]));
  fs.writeFileSync(`${b}.nm`, archive(b, [['rn-whisper.o', bLines]]));
  const result = spawnSync('bash', [SCRIPT, ...(args || [a, b])], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
      STUB_CXXFILT_MAP: path.join(tmp, 'cxxfilt.map'),
      ...env,
    },
  });
  const verdicts = result.stdout
    .split('\n')
    .filter(line => /^(ALLOW|DENY) /.test(line));
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    verdicts,
  };
}

describe('allowed overlap', () => {
  it('passes std::, JSI, React, the terminate helper and ThreadPool', () => {
    const shared = [STD, JSI, REACT, TERMINATE, THREAD_POOL];
    const result = run([...shared, OWN_A], [...shared, OWN_B]);
    expect(result.verdicts).toEqual([
      'ALLOW weak private external / weak private external std::__1::vector<int, std::__1::allocator<int> >::~vector()',
      'ALLOW weak private external / weak private external facebook::jsi::Value::~Value()',
      'ALLOW weak private external / weak private external facebook::react::CallInvoker::~CallInvoker()',
      'ALLOW weak private external / weak private external __clang_call_terminate',
      'ALLOW private external / private external ThreadPool::ThreadPool(unsigned long)',
    ]);
    expect(result.stdout).toContain(`  ${THREAD_POOL}\n  ${THREAD_POOL}\n`);
    expect(result.stdout).toContain('5 shared, 0 denied');
    expect(result.status).toBe(0);
  });

  it('passes archives that share nothing', () => {
    const result = run([OWN_A], [OWN_B]);
    expect(result.verdicts).toEqual([]);
    expect(result.stdout).toContain('0 shared, 0 denied');
    expect(result.status).toBe(0);
  });
});

describe('denied overlap', () => {
  it.each([
    [
      'a weak hidden ggml::cpu vtable',
      GGML_VTABLE,
      'DENY weak private external / weak private external vtable for ggml::cpu::extra_buffer_type',
    ],
    [
      'a strong hidden ggml::cpu destructor',
      GGML_DTOR,
      'DENY private external / private external ggml::cpu::extra_buffer_type::~extra_buffer_type()',
    ],
    [
      'a strong dl_ function',
      DL_LOAD,
      'DENY private external / private external dl_load_library(std::__1::__fs::filesystem::path const&)',
    ],
    [
      'a std:: instantiation over a ggml type',
      STD_OVER_GGML,
      'DENY weak private external / weak private external std::__1::vector<ggml_tensor*, std::__1::allocator<ggml_tensor*> >::~vector()',
    ],
    [
      'a std:: instantiation over a dl_ type',
      STD_OVER_DL,
      'DENY weak private external / weak private external std::__1::unique_ptr<void, dl_handle_deleter>::reset(void*)',
    ],
  ])('fails on %s', (_, line, verdict) => {
    const result = run([STD, line, OWN_A], [STD, line, OWN_B]);
    expect(result.verdicts).toContain(verdict);
    expect(result.stdout).toContain(`  ${line}\n  ${line}\n`);
    expect(result.stdout).toContain('2 shared, 1 denied');
    expect(result.status).toBe(1);
  });

  it('fails on a first-party name outside the allowed namespaces', () => {
    const line = sym('0000000000000280', 'external', '__ZN6pocket6helperEv');
    const result = run([line], [line]);
    expect(result.verdicts).toEqual([
      'DENY external / external pocket::helper()',
    ]);
    expect(result.status).toBe(1);
  });

  it('fails when only one side is weak', () => {
    const strong = sym(
      '0000000000000100',
      'private external',
      '__ZTVN4ggml3cpu17extra_buffer_typeE',
      '(__DATA,__const)',
    );
    const result = run([strong], [GGML_VTABLE]);
    expect(result.verdicts).toEqual([
      'DENY private external / weak private external vtable for ggml::cpu::extra_buffer_type',
    ]);
    expect(result.status).toBe(1);
  });
});

describe('the binding filter', () => {
  it('ignores names that are non-external on either side', () => {
    const local = sym(
      '0000000000000300',
      'non-external',
      '__ZN4ggml3cpu5localEv',
    );
    const wasHidden = sym(
      '0000000000000340',
      'non-external (was a private external)',
      '__ZN4ggml3cpu17extra_buffer_typeD2Ev',
    );
    const result = run([local, wasHidden, OWN_A], [local, GGML_DTOR, OWN_B]);
    expect(result.verdicts).toEqual([]);
    expect(result.status).toBe(0);
  });

  it('keeps a binding it does not know, so a new kind of collision fails', () => {
    const autoHidden = sym(
      '0000000000000100',
      'weak external automatically hidden',
      '__ZTVN4ggml3cpu17extra_buffer_typeE',
      '(__DATA,__const)',
    );
    const unknown = sym('0000000000000380', 'brand-new kind', '_ggml_future');
    const result = run([autoHidden, unknown], [autoHidden, unknown]);
    expect(result.verdicts).toEqual([
      'DENY weak external automatically hidden / weak external automatically hidden vtable for ggml::cpu::extra_buffer_type',
      'DENY brand-new kind / brand-new kind ggml_future',
    ]);
    expect(result.status).toBe(1);
  });

  it('drops bracketed annotations around the binding', () => {
    const annotated = sym(
      '0000000000000180',
      '[referenced dynamically] external [no dead strip]',
      '__Z15dl_load_libraryRKNSt3__14__fs10filesystem4pathE',
    );
    const result = run([annotated], [DL_LOAD]);
    expect(result.verdicts).toEqual([
      'DENY external / private external dl_load_library(std::__1::__fs::filesystem::path const&)',
    ]);
    expect(result.status).toBe(1);
  });

  it('keeps a common symbol', () => {
    const common = sym(
      '0000000000000008',
      '(alignment 2^3) external',
      '_ggml_common',
      '(common)',
    );
    const result = run([common], [common]);
    expect(result.verdicts).toEqual([
      'DENY (alignment 2^3) external / (alignment 2^3) external ggml_common',
    ]);
    expect(result.status).toBe(1);
  });
});

describe('demangling', () => {
  it('strips exactly one underscore before demangling', () => {
    const result = run([STD], [STD]);
    expect(result.verdicts).toEqual([
      'ALLOW weak private external / weak private external std::__1::vector<int, std::__1::allocator<int> >::~vector()',
    ]);
  });

  it('denies a std:: name that stayed mangled, rather than allowing it', () => {
    fs.writeFileSync(path.join(tmp, 'cxxfilt.map'), '');
    const result = run([STD], [STD]);
    expect(result.verdicts).toEqual([
      'DENY weak private external / weak private external _ZNSt3__16vectorIiNS_9allocatorIiEEED2Ev',
    ]);
    expect(result.status).toBe(1);
  });
});

describe('failures', () => {
  it('fails when an archive has no external symbols', () => {
    const result = run([STD], []);
    expect(result.stderr).toContain('no external symbols in');
    expect(result.status).toBe(1);
  });

  it('fails when an archive has only non-external symbols', () => {
    const local = sym('0000000000000300', 'non-external', '_local');
    const result = run([local], [STD]);
    expect(result.stderr).toContain('no external symbols in');
    expect(result.status).toBe(1);
  });

  it('fails when nm cannot read an archive', () => {
    const result = run([STD], [STD], {env: {STUB_NM_FAIL: '1'}});
    expect(result.stderr).toContain('nm could not read');
    expect(result.status).toBe(1);
  });

  it.each([[[]], [['a.a']], [['a.a', 'b.a', 'c.a']]])(
    'prints usage and exits 64 for %j',
    args => {
      const result = run([STD], [STD], {args});
      expect(result.stderr).toMatch(/^usage: /);
      expect(result.status).toBe(64);
    },
  );
});
