# Credential-owner findings

Measured on 2026-09-02 on Fedora Linux 44 with kernel
`7.1.8-200.fc44.x86_64`. Nothing was installed. No existing credential was
used to sign, no private or identifying credential material was printed, and
all synthetic private material was removed with its `/tmp` directory.

## Finding

**No credential owner tested on this machine can be the first petition proof
profile. Consequential petitions remain blocked.**

The closest measured mechanism was a disposable OpenSSH agent. It bound a
signature to a structural version-one envelope, verified after the agent and
private-key file were gone, rejected a one-byte change, and showed current KRL
rejection alongside public-only verification without that current policy. It
nevertheless failed the decisive requirements:

- its confirmation prompt asked only whether a key could be used and contained
  none of the petition content;
- the agent received neither the 1,280 envelope bytes nor the unique `userText`
  marker, so the credential owner could not parse or render the transaction
  from those bytes; and
- the only principal mapping exercised was a synthetic `allowed_signers`
  entry, not a mapping to a user already recognized by a target runtime.

GPG also signed and verified exact synthetic input, but it signed unattended
with pinentry disabled and emitted none of the input marker. Its synthetic
revocation path can fail closed only when the verifier treats machine-readable
`REVKEYSIG` as failure; default `gpg --verify` returned zero for the revoked
signature. No existing GPG agent key or smartcard was safely established.

Every other required candidate was either absent, lacked usable hardware, or
did not expose a signing owner that could be exercised. Most importantly, no
tested path showed trusted transaction confirmation derived from the canonical
envelope bytes.

## Required properties

The columns below use the six properties from
`docs/tasks/013-credential-owner.md`:

1. **Bytes**: the credential owner accepts the canonical envelope bytes and
   the proof binds those exact bytes.
2. **Confirm**: a trusted surface shows the transaction derived from those
   bytes and requires deliberate approval.
3. **Isolate**: the requesting process and another agent sharing the user's
   account cannot read the private key.
4. **Durable**: a proof made while its authority is current remains
   independently verifiable after that authority has expired.
5. **Revoke**: current revocation fails closed without erasing verification of
   a proof made while the credential was valid.
6. **Principal**: the credential maps to the same user already recognized by
   the target runtime.

`D` means demonstrated by an executed probe. `F` means executed behavior
contradicted the requirement. `P` means only part of the property was
demonstrated. `U` means untested; it never means pass. A profile qualifies only
if all six properties are demonstrated, along with the local-disclosure and
retention obligations in `docs/petition-identity.md`.

| Candidate | Availability measured | Bytes | Confirm | Isolate | Durable | Revoke | Principal | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebAuthn / FIDO2 | `libfido2` present; zero HID devices discovered | U | U | U | U | U | U | No owner available to test |
| `systemd-creds` / TPM2 | Tools present; no TPM device | U | U | U | U | U | U | No hardware owner available |
| Existing GPG agent / smartcard | Agent answered with zero key records; no USB CCID interface | U | U | U | U | U | U | No usable credential established |
| Synthetic GPG software/agent path | GnuPG 2.4.9 exercised in isolation | P | F | F | P | P | U | Does not qualify |
| `age`, `minisign`, `signify` | Binaries absent | U | U | U | U | U | U | Not present |
| Synthetic OpenSSH agent path | OpenSSH 10.2p1 exercised in isolation; no existing agent exposed | P | F | P | P | P | U | Does not qualify |
| OpenSSL file signer | OpenSSL 3.5.7 exercised with a disposable file key | P | F | F | P | U | U | Does not qualify |
| Secret Service / GNOME Keyring | Clients and PKCS#11 module installed; no reachable service | U | U | U | U | U | U | No live signing owner established |
| Linux kernel keyring | `keyctl` present; session keyring reachable | U | U | U | U | U | U | No signing owner tested |

### WebAuthn and FIDO2

The installed `libfido2` library successfully enumerated zero devices. There
were also zero `/sys/class/hidraw` entries. No `fido2-*` command-line tool was
installed. Consequently no assertion, authenticator capability, user
verification, or transaction-confirmation behavior was exercised.

This does not establish that BLE, NFC, or a browser-mediated platform
authenticator is absent. Those paths are **untested** because no safe,
noninteractive enumerator for them was present. Firefox being installed is not
evidence of an available authenticator.

### TPM2 and systemd-creds

`tpm2-tools`, the TPM libraries, and `systemd-creds` were installed, but there
was no `/dev/tpm*`, `/dev/tpmrm*`, or `/sys/class/tpm/tpm*` entry.
`systemd-analyze has-tpm2` reported `partial` with firmware and driver absent,
and `systemd-creds --tpm2-device=list` reported no suitable device.

`systemd-creds --help` exposed credential encryption and decryption, not a
petition-signing or transaction-display operation. `tpm2_sign --help=man`
described message or digest signing, but no TPM existed and no operation was
run. Help text is documentation, not demonstrated capability.

### GPG and card-backed keys

GPG's existing agent answered `KEYINFO --list` with zero records. The machine
had zero visible USB CCID-class interfaces, no running `pcscd`, and no PC/SC
runtime socket. Reader enumeration was deliberately not run because it could
activate the enabled socket and disclose reader or token identifiers. A
non-USB reader or card behind the inactive service therefore remains
**untested**, not absent.

The synthetic software path demonstrated generic exact-input signature
integrity and public-only verification after signer removal. It did not receive
a canonical petition envelope or verify after a petition authority interval
expired, so both properties remain partial. It failed trusted confirmation:
signing succeeded with `--pinentry-mode error`, made zero pinentry calls, and
did not display the input marker. It also failed same-account isolation because
the same synthetic account owned the unprotected signing home and could invoke
signing unattended.

After revocation, the signing home refused another signature. A current
verifier emitted `KEYREVOKED` and `REVKEYSIG`, but default `gpg --verify` still
returned zero. A strict status parser rejected it, while an archived
pre-revocation public verifier still accepted the original proof. This shows a
possible verifier mechanism, not an existing proof profile or trusted
historical signing time.

### age, minisign, and signify

`age`, `age-keygen`, `age-plugin-yubikey`, `minisign`, `signify`, and
`signify-openbsd` were not installed. No property was tested and nothing was
installed to change that result.

### SSH agent signing

No `SSH_AUTH_SOCK` was exposed, and `ssh-add -l` could not connect to an
authentication agent. The installed mechanism was therefore tested with a
disposable key and an isolated disposable agent only.

The synthetic run loaded the key with `ssh-add -c`, deleted the private-key
file, and signed through the agent inside `bwrap --unshare-net`. Verification
succeeded after the agent stopped. A same-length, one-byte mutation failed,
which is the required negative control. A KRL made current-policy verification
fail, while verification without that current KRL and `check-novalidate`
continued to verify the historical cryptographic proof.

The run did not wait until the envelope's signed `expiresAt`, so it demonstrated
verification after signer disappearance, not after authority expiry. Durable
verification is therefore partial. The KRL was supplied manually and the
signature has no trusted signing time, so the complete current-versus-
historical revocation property is also partial.

Those successes do not satisfy the credential-owner boundary. The captured
confirmation was two lines; its first line was `Allow use of key
<SYNTHETIC_KEY_IDENTIFIER>?`, and the unique petition marker appeared nowhere
in it. A Unix-socket proxy also measured that the 1,280-byte envelope and its
marker appeared nowhere in the client-to-agent stream. The stream contained two
agent requests with 182 payload bytes total and a maximum payload of 181 bytes.
This executed OpenSSH path therefore gave the owner derived signing input, not
the canonical transaction it would have to validate and render.

Deleting the private-key file showed separation from the requesting
`ssh-keygen` process. It did not prove resistance to every same-account process
or memory attack, so private-key isolation remains partial. The synthetic
`allowed_signers` mapping proves only that OpenSSH can apply a caller-created
mapping; it says nothing about a target runtime's existing user principal.

### File signers

The synthetic OpenSSL Ed25519 path signed generic non-empty input, verified with
a public key after the private file was removed, and rejected altered input. It
did not receive a canonical envelope or verify after an authority interval
expired. It signed without confirmation and its ordinary private-key file was
readable by the requesting account. It has no tested credential lifecycle or
runtime-principal mapping. It cannot qualify.

The GPG and SSH results above likewise show why a file-signing format is not a
credential owner by itself. Cryptographic integrity and durable verification
do not supply informed approval, protected ownership, revocation semantics, or
principal identity.

### Secret Service, GNOME Keyring, and kernel keyrings

`secret-tool`, `gnome-keyring-daemon`, and GNOME Keyring's PKCS#11 module were
installed. No session or system D-Bus was reachable from the probe environment,
no matching daemon process was visible, and no service was activated. The
`secret-tool` interface offers secret storage operations rather than signing;
the separate PKCS#11 module was not exercised. No asymmetric signing owner or
trusted transaction display was demonstrated.

The `keyctl` client and a reachable Linux session keyring were present. No
private key, signing operation, display, per-key isolation, lifecycle, or
principal mapping was tested through it. Kernel-keyring presence alone does not
demonstrate any proof property.

### Local processing and retention

The synthetic SSH and GPG cryptographic operations completed inside
`bwrap --unshare-net`, so those exact runs made no network flow. Their scratch
directories and private material were removed. This proves only the synthetic
paths: no real FIDO, TPM, card, desktop keychain, or existing agent operation
ran, and no real owner's logs, caches, crash handling, restart behavior, or
bounded content retention was measured.

The SSH agent-stream capture strengthens the negative result rather than the
retention case: the owner did not receive the envelope content at all, so it
could neither render it nor retain it. The requesting `ssh-keygen` process did
receive the content, but it is not the isolated credential owner required by
the contract.

## Reproducible inventory

The inventory commands through **Agent and keychain availability** are
read-only. Outputs suppress identifiers and credential material. The aggregate
GPG and SSH checks do contact an existing agent if one is exposed to the
process; they do not sign, and their raw output is discarded rather than
retained. Later synthetic controls create credentials only inside disposable
sandboxes.

### Software and device inventory

```sh
uname -sr
. /etc/os-release
printf '%s\n' "$PRETTY_NAME"

for command in \
    fido2-token fido2-assert fido2-cred \
    systemd-creds tpm2_getcap tpm2_sign \
    gpg gpg-connect-agent age age-keygen age-plugin-yubikey \
    minisign signify signify-openbsd ssh-keygen ssh-add openssl \
    secret-tool gnome-keyring-daemon keyctl
do
    if command -v "$command" >/dev/null 2>&1; then
        printf '%s=present\n' "$command"
    else
        printf '%s=absent\n' "$command"
    fi
done
```

Measured output:

```text
Linux 7.1.8-200.fc44.x86_64
Fedora Linux 44 (Workstation Edition)
fido2-token=absent
fido2-assert=absent
fido2-cred=absent
systemd-creds=present
tpm2_getcap=present
tpm2_sign=present
gpg=present
gpg-connect-agent=present
age=absent
age-keygen=absent
age-plugin-yubikey=absent
minisign=absent
signify=absent
signify-openbsd=absent
ssh-keygen=present
ssh-add=present
openssl=present
secret-tool=present
gnome-keyring-daemon=present
keyctl=present
```

Relevant installed versions were:

```sh
rpm -q \
    libfido2 systemd tpm2-tools tpm2-tss gnupg2 \
    libsecret gnome-keyring keyutils
ssh -V 2>&1
```

```text
libfido2-1.16.0-5.fc44.x86_64
systemd-259.8-1.fc44.x86_64
tpm2-tools-5.7-5.fc44.x86_64
tpm2-tss-4.1.3-9.fc44.x86_64
gnupg2-2.4.9-16.fc44.x86_64
OpenSSH_10.2p1, OpenSSL 3.5.7 9 Jun 2026
libsecret-0.21.7-10.fc44.x86_64
gnome-keyring-50.0-1.fc44.x86_64
keyutils-1.6.3-7.fc44.x86_64
```

### FIDO device enumeration

This calls the installed `libfido2` directly because its CLI tools and headers
were absent:

```python
import ctypes

lib = ctypes.CDLL("libfido2.so.1")
lib.fido_init.argtypes = [ctypes.c_int]
lib.fido_dev_info_new.argtypes = [ctypes.c_size_t]
lib.fido_dev_info_new.restype = ctypes.c_void_p
lib.fido_dev_info_manifest.argtypes = [
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
lib.fido_dev_info_manifest.restype = ctypes.c_int
lib.fido_dev_info_free.argtypes = [
    ctypes.POINTER(ctypes.c_void_p),
    ctypes.c_size_t,
]
lib.fido_strerr.argtypes = [ctypes.c_int]
lib.fido_strerr.restype = ctypes.c_char_p

lib.fido_init(0)
devices = ctypes.c_void_p(lib.fido_dev_info_new(64))
found = ctypes.c_size_t()
result = lib.fido_dev_info_manifest(
    devices,
    64,
    ctypes.byref(found),
)

print(
    "manifest-rc="
    + str(result)
    + " ("
    + lib.fido_strerr(result).decode()
    + ")"
)
print("manifest-count=" + str(found.value))

lib.fido_dev_info_free(ctypes.byref(devices), 64)
raise SystemExit(0 if result == 0 else 1)
```

Saved as `fido_manifest.py` under a temporary directory and run with
`python3 fido_manifest.py`, it produced:

```text
manifest-rc=0 (FIDO_ERR_SUCCESS)
manifest-count=0
```

The independent sysfs count was:

```sh
find /sys/class/hidraw -mindepth 1 -maxdepth 1 -type l 2>/dev/null |
    awk 'END { print "hidraw-sysfs-count=" NR }'
```

```text
hidraw-sysfs-count=0
```

### TPM device enumeration

```sh
for pattern in /sys/class/tpm/tpm\* /dev/tpm\* /dev/tpmrm\*; do
    found=0
    for path in $pattern; do
        [ -e "$path" ] || continue
        found=1
        printf '%s\n' "$path"
    done
    [ "$found" -eq 1 ] || printf '%s: none\n' "$pattern"
done

systemd-analyze has-tpm2
printf 'has-tpm2-status=%s\n' "$?"
systemd-creds --tpm2-device=list 2>&1
printf 'device-list-status=%s\n' "$?"
```

Measured output:

```text
/sys/class/tpm/tpm*: none
/dev/tpm*: none
/dev/tpmrm*: none
partial
-firmware
-driver
+system
-subsystem
+libraries
  +libtss2-esys.so.0
  +libtss2-rc.so.0
  +libtss2-mu.so.0
has-tpm2-status=11
No suitable TPM2 devices found.
device-list-status=0
```

The zero status from `systemd-creds` does not mean a device was found; its
output explicitly says none was suitable.

### GPG agent and smartcard substrate

```bash
scratch=$(mktemp -d /tmp/ecosym013-card.XXXXXX)
cd "$scratch"

interfaces=0
: > parents
for file in /sys/bus/usb/devices/*/bInterfaceClass; do
    [ -r "$file" ] || continue
    [ "$(tr '[:upper:]' '[:lower:]' < "$file")" = 0b ] || continue
    interfaces=$((interfaces + 1))
    basename "$(dirname "$file")" | sed 's/:.*//' >> parents
done
devices=$(sort -u parents | awk 'NF { n++ } END { print n + 0 }')
printf 'usb-ccid interfaces=%s devices=%s\n' "$interfaces" "$devices"

for command in pcscd pcsc_scan opensc-tool pkcs11-tool; do
    if command -v "$command" >/dev/null 2>&1; then
        printf '%s=present\n' "$command"
    else
        printf '%s=absent\n' "$command"
    fi
done

systemctl is-active --quiet pcscd.service 2>/dev/null
printf 'pcscd.service active_rc=%s\n' "$?"
systemctl is-active --quiet pcscd.socket 2>/dev/null
printf 'pcscd.socket active_rc=%s\n' "$?"
systemctl is-enabled --quiet pcscd.socket 2>/dev/null
printf 'pcscd.socket enabled_rc=%s\n' "$?"
printf 'pcscd-process-count=%s\n' \
    "$(pgrep -x pcscd 2>/dev/null | awk 'NF { n++ } END { print n + 0 }')"
test -S /run/pcscd/pcscd.comm
printf 'pcsc-runtime-socket-present rc=%s\n' "$?"

set -o pipefail
records=$(
    gpg-connect-agent --no-autostart 'KEYINFO --list' /bye 2>/dev/null |
        awk '/^S KEYINFO / { records++ } END { print records + 0 }'
)
status=$?
set +o pipefail
printf 'gpg-agent-keyinfo rc=%s records=%s identifiers=suppressed\n' \
    "$status" "$records"

rm -rf "$scratch"
```

Measured output:

```text
usb-ccid interfaces=0 devices=0
pcscd=present
pcsc_scan=absent
opensc-tool=present
pkcs11-tool=present
pcscd.service active_rc=1
pcscd.socket active_rc=1
pcscd.socket enabled_rc=0
pcscd-process-count=0
pcsc-runtime-socket-present rc=1
gpg-agent-keyinfo rc=0 records=0 identifiers=suppressed
```

### Agent and keychain availability

```sh
if [ -n "${SSH_AUTH_SOCK:-}" ]; then
    printf 'SSH_AUTH_SOCK_configured=yes\n'
else
    printf 'SSH_AUTH_SOCK_configured=no\n'
fi
ssh-add -l </dev/null >/dev/null 2>&1
printf 'ssh-add-list-status=%s\n' "$?"

for process in gnome-keyring-d kwalletd5 kwalletd6 keepassxc; do
    count=$(pgrep -xc "$process" 2>/dev/null || true)
    printf '%-20s %s\n' "$process" "$count"
done

test -e /usr/lib64/pkcs11/gnome-keyring-pkcs11.so
printf 'gnome-keyring-pkcs11-module-status=%s\n' "$?"

gdbus call --session \
    --dest org.freedesktop.DBus \
    --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.NameHasOwner \
    org.freedesktop.DBus 2>&1
printf 'session-dbus-status=%s\n' "$?"

gdbus call --system \
    --dest org.freedesktop.DBus \
    --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.NameHasOwner \
    org.freedesktop.DBus 2>&1
printf 'system-dbus-status=%s\n' "$?"
```

Measured output, with the D-Bus error reproduced verbatim because it contains
no bus address:

```text
SSH_AUTH_SOCK_configured=no
ssh-add-list-status=2
gnome-keyring-d      0
kwalletd5            0
kwalletd6            0
keepassxc            0
gnome-keyring-pkcs11-module-status=0
Error connecting: Cannot autolaunch D-Bus without X11 $DISPLAY
session-dbus-status=1
Error connecting: Could not connect: No such file or directory
system-dbus-status=1
```

### OpenSSL file-key control

This control demonstrates only file-signature integrity and public-only
verification. The unencrypted private key is an ordinary file owned by the
requesting account, and signing succeeds noninteractively. Run it saved as a
temporary executable script. Its private file exists only in the sandbox's
private `/tmp` tmpfs.

```sh
#!/bin/sh
set -u

if [ "${1-}" != --inside ]; then
    bwrap --die-with-parent --unshare-net \
        --ro-bind / / \
        --tmpfs /tmp \
        --dev /dev \
        --proc /proc \
        --ro-bind "$0" /tmp/probe \
        /tmp/probe --inside
    status=$?
    printf 'sandbox_rc=%s cleanup=namespace-destroyed\n' "$status"
    exit "$status"
fi

cd /tmp
umask 077

printf %s ECOSYM013_OPENSSL_MARKER > input
openssl genpkey -algorithm ED25519 -out private.pem \
    >/dev/null 2>&1
generate_status=$?
openssl pkey -in private.pem -pubout -out public.pem \
    >/dev/null 2>&1
public_status=$?
openssl pkeyutl -sign -rawin -inkey private.pem \
    -in input -out signature </dev/null >/dev/null 2>&1
sign_status=$?

rm private.pem
openssl pkeyutl -verify -rawin -pubin -inkey public.pem \
    -in input -sigfile signature >/dev/null 2>&1
verify_status=$?

sed 's/OPENSSL/N PENSSL/' input | tr -d ' ' > tampered
differences=$(cmp -l input tampered | wc -l)
openssl pkeyutl -verify -rawin -pubin -inkey public.pem \
    -in tampered -sigfile signature >/dev/null 2>&1
tampered_status=$?

printf 'generate_rc=%s public_rc=%s sign_rc=%s private_key_removed=%s verify_rc=%s cmp_difference_count=%s tampered_verify_rc=%s\n' \
    "$generate_status" "$public_status" "$sign_status" \
    "$(test -e private.pem && echo no || echo yes)" \
    "$verify_status" "$differences" "$tampered_status"

probe_status=0
[ "$generate_status" -eq 0 ] || probe_status=1
[ "$public_status" -eq 0 ] || probe_status=1
[ "$sign_status" -eq 0 ] || probe_status=1
[ ! -e private.pem ] || probe_status=1
[ "$verify_status" -eq 0 ] || probe_status=1
[ "$differences" -eq 1 ] || probe_status=1
[ "$tampered_status" -ne 0 ] || probe_status=1
exit "$probe_status"
```

Measured output:

```text
generate_rc=0 public_rc=0 sign_rc=0 private_key_removed=yes verify_rc=0 cmp_difference_count=1 tampered_verify_rc=1
sandbox_rc=0 cleanup=namespace-destroyed
```

## Canonical-envelope control

This is the worked exact-byte example. It uses a disposable Ed25519 key and
agent, a CSPRNG petition ID, synthetic identifiers, and the exact documented
version-one field sets. It cannot validate request semantics because no
consequential request type exists, so the fixture is structural and is not an
authorizing petition.

The restricted fixture contains only ASCII strings, integer `1`, empty objects,
and `null`. The script sorts every object key and uses compact JSON encoding;
for those values the output is JCS-compatible. The signing, verification, and
stream capture run without network access. It prints no key, fingerprint,
petition ID, signature, or protocol bytes.

Measured output:

```text
envelope_structure_and_canonicalization=pass
request_semantic_validation=unavailable-no-consequential-request-type
confirmed_key_loaded=yes
private_key_file_deleted_before_sign=yes
signing_network_isolation=bwrap-unshare-net
askpass_prompt_sanitized=Allow use of key <SYNTHETIC_KEY_IDENTIFIER>?
askpass_prompt_line_count=2
request_marker_in_askpass_prompt=no
agent_stopped_before_verification=yes
public_only_verification=success
cmp_difference_count=1
one_byte_tamper_verification=failed-as-required
current_krl_verification=failed-as-required
historical_verification_without_current_krl=success
exact_envelope_in_client_to_agent_stream=no
request_marker_in_client_to_agent_stream=no
envelope_byte_count=1280
client_agent_request_count=2
client_agent_request_payload_max_bytes=181
client_agent_request_payload_total_bytes=182
structural_fixture_not_authorizing_petition=yes
experiment_status=success
cleanup=complete
```

The complete command is in [Appendix A](#appendix-a-ssh-agent-probe).

## GPG lifecycle control

The GPG control used a disposable RSA signing key, a separate public-only
verification home, one binary payload containing NUL and `0xff`, a one-byte
mutation, and the generated revocation certificate. It ran under
`bwrap --unshare-net` and removed every synthetic home afterward.

Measured output:

```text
generate_rc=0 export_rc=0 sign_rc=0 confirmation_required=no pinentry_invocations=0 marker_in_signer_or_pinentry_output=no
signing_home_revocation_import_rc=0 post_revocation_sign_rc=2 post_sign_pinentry_invocations=0
signing_home_removed=yes
public_only_secret_records=0 pre_revocation_verify_rc=0 status_names=GOODSIG,KEY_CONSIDERED,NEWSIG,SIG_ID,TRUST_UNDEFINED,VALIDSIG one_byte_mutation_verify_rc=1 mutation_status_names=BADSIG,FAILURE,KEY_CONSIDERED,NEWSIG
revocation_import_rc=0 default_current_verify_rc=0 current_status_names=KEY_CONSIDERED,KEYREVOKED,NEWSIG,REVKEYSIG,SIG_ID,TRUST_UNDEFINED,VALIDSIG strict_current_rc=1 archived_verify_rc=0 archived_status_names=GOODSIG,KEY_CONSIDERED,NEWSIG,SIG_ID,TRUST_UNDEFINED,VALIDSIG strict_archived_rc=0
inside_cleanup=complete
sandbox_rc=0 cleanup=namespace-destroyed
```

The complete command is in [Appendix B](#appendix-b-gpg-lifecycle-probe).

## Recommendation

Select **none** of the tested owners as the first proof profile. In particular,
do not treat SSH agent confirmation, GPG pinentry, TPM sealing, a Secret Service
item, or a file signature as transaction confirmation.

The next measurement can recommend a profile only after an actual candidate
owner is present and executes all of the following in one synthetic test:

- accepts and validates the complete canonical envelope bytes;
- derives both the digest and transaction view from those bytes inside the
  owner;
- displays the principal, audience, civilization, typed request and limits,
  consequence disclosure, and absolute expiry on a trusted surface;
- attests deliberate approval and binds it to the envelope digest;
- keeps the private key unavailable to same-account requesting agents;
- signs while the interval is current, then verifies the retained proof after
  `expiresAt` and a verifier restart without treating it as current authority;
- fails current revocation closed while preserving evidence that a proof made
  before revocation was then valid;
- maps the credential through a target runtime's existing authenticated user
  path; and
- demonstrates no outbound content flow and bounded content retention.

No statement in `docs/petition-identity.md` was shown to be impossible in
general. Its first proof profile is, however, **unbuildable with every owner
available to these probes**. The OpenSSH result is specifically incompatible
with the contract as written: changing only its prompt renderer cannot fix the
boundary because the agent did not receive the canonical envelope to render.
The blocker named by that document therefore remains unresolved.

## Appendix A: SSH agent probe

Run this saved as a temporary executable script. It installs nothing and its
trap removes the generated key, agent, signatures, protocol capture, and
fixture.

```sh
#!/bin/sh
set -eu

D=/tmp/ecosym-task013-final.$$
AGENT_PID=
PROXY_PID=

cleanup() {
    [ -z "${PROXY_PID:-}" ] || {
        kill "$PROXY_PID" 2>/dev/null || :
        wait "$PROXY_PID" 2>/dev/null || :
    }
    [ -z "${AGENT_PID:-}" ] || {
        kill "$AGENT_PID" 2>/dev/null || :
        wait "$AGENT_PID" 2>/dev/null || :
    }
    rm -rf "$D"
    echo cleanup=complete
}
trap cleanup EXIT HUP INT TERM

mkdir -m 700 "$D"
cd "$D"
export HOME="$D"
unset SSH_AUTH_SOCK SSH_AGENT_PID

python3 - <<'PY'
import base64
import json
import secrets

digest = lambda character: "sha256:" + character * 64

envelope = {
    "audience": {
        "controlPlaneId": "synthetic-control-plane",
        "runtimeId": "synthetic-runtime",
    },
    "authorityBasis": {
        "type": "direct-user-petition",
    },
    "authorityContext": {
        "mandateDigest": digest("2"),
        "mandateId": "synthetic-mandate",
        "mandateRevision": "synthetic-revision-1",
    },
    "civilizationId": "synthetic-civilization",
    "credentialId": "synthetic-credential",
    "expiresAt": "2030-01-01T00:05:00.000Z",
    "notBefore": "2030-01-01T00:00:00.000Z",
    "petitionId": (
        "petition:"
        + base64.urlsafe_b64encode(secrets.token_bytes(32))
        .rstrip(b"=")
        .decode("ascii")
    ),
    "predecessorPetitionId": None,
    "principal": {
        "issuer": "synthetic-runtime-identity-namespace",
        "subject": "synthetic-existing-principal",
    },
    "proofProfile": {
        "definitionDigest": digest("1"),
        "id": "synthetic-proof-profile",
        "revision": "synthetic-revision-1",
    },
    "request": {
        "consequence": {
            "classification": "ordinary",
            "recoverability": None,
            "summary": None,
        },
        "limits": {},
        "operation": "synthetic-structural-operation",
        "parameters": {},
        "resources": {},
        "type": {
            "definitionDigest": digest("3"),
            "id": "synthetic-undefined-request-type",
            "revision": "synthetic-revision-1",
        },
        "userText": "ECOSYM_TASK013_UNIQUE_CONTENT_MARKER",
    },
    "schemaVersion": 1,
}

open("envelope.jcs", "wb").write(
    json.dumps(
        envelope,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii")
)
PY

python3 - <<'PY'
import base64
import json
import re

raw = open("envelope.jcs", "rb").read()
envelope = json.loads(raw)
keys = lambda value: set(value)

assert raw.isascii()
assert not raw.endswith(b"\n")

assert keys(envelope) == {
    "schemaVersion",
    "petitionId",
    "principal",
    "credentialId",
    "proofProfile",
    "audience",
    "civilizationId",
    "authorityContext",
    "authorityBasis",
    "request",
    "notBefore",
    "expiresAt",
    "predecessorPetitionId",
}
assert keys(envelope["principal"]) == {"issuer", "subject"}
assert keys(envelope["proofProfile"]) == {
    "id",
    "revision",
    "definitionDigest",
}
assert keys(envelope["audience"]) == {
    "runtimeId",
    "controlPlaneId",
}
assert keys(envelope["authorityContext"]) == {
    "mandateId",
    "mandateRevision",
    "mandateDigest",
}
assert keys(envelope["authorityBasis"]) == {"type"}
assert keys(envelope["request"]) == {
    "type",
    "operation",
    "resources",
    "parameters",
    "limits",
    "userText",
    "consequence",
}
assert keys(envelope["request"]["type"]) == {
    "id",
    "revision",
    "definitionDigest",
}
assert keys(envelope["request"]["consequence"]) == {
    "classification",
    "summary",
    "recoverability",
}

encoded_id = envelope["petitionId"][9:]
assert envelope["petitionId"].startswith("petition:")
assert "=" not in encoded_id
assert re.fullmatch(r"[A-Za-z0-9_-]{43}", encoded_id)
assert len(base64.urlsafe_b64decode(encoded_id + "=")) == 32

instant = re.compile(
    r"\d{4}-\d{2}-\d{2}T"
    r"\d{2}:\d{2}:\d{2}\.\d{3}Z"
)
assert instant.fullmatch(envelope["notBefore"])
assert instant.fullmatch(envelope["expiresAt"])

digest = re.compile(r"sha256:[0-9a-f]{64}")
assert all(
    digest.fullmatch(value)
    for value in (
        envelope["proofProfile"]["definitionDigest"],
        envelope["authorityContext"]["mandateDigest"],
        envelope["request"]["type"]["definitionDigest"],
    )
)

assert raw == json.dumps(
    envelope,
    ensure_ascii=True,
    sort_keys=True,
    separators=(",", ":"),
).encode("ascii")
PY

echo envelope_structure_and_canonicalization=pass
echo request_semantic_validation=unavailable-no-consequential-request-type

ssh-keygen -q -t ed25519 -N '' \
    -C synthetic-task013-disposable \
    -f key

printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''%s\n'\'' "$*" >> "$ASKPASS_LOG"' \
    'exit 0' \
    > askpass.sh

chmod 700 askpass.sh
: > askpass.log

export SSH_ASKPASS="$D/askpass.sh"
export SSH_ASKPASS_REQUIRE=force
export ASKPASS_LOG="$D/askpass.log"
export DISPLAY=synthetic-task013

REAL_SOCK="$D/real.sock"
PROXY_SOCK="$D/proxy.sock"

SSH_AUTH_SOCK="$REAL_SOCK" \
    ssh-agent -D -a "$REAL_SOCK" > agent.log 2>&1 &
AGENT_PID=$!

i=0
while [ ! -S "$REAL_SOCK" ]; do
    i=$((i + 1))
    [ "$i" -lt 100 ] || exit 1
    sleep .02
done

SSH_AUTH_SOCK="$REAL_SOCK" \
    ssh-add -c key </dev/null > add.log 2>&1

rm -f key
[ ! -e key ]

echo confirmed_key_loaded=yes
echo private_key_file_deleted_before_sign=yes

cat > proxy.py <<'PY'
import socket
import sys
import threading

listen_path, upstream_path, capture_path = sys.argv[1:]

server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(listen_path)
server.listen(1)

client, _ = server.accept()
upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
upstream.connect(upstream_path)


def outbound():
    with open(capture_path, "wb") as capture:
        while True:
            data = client.recv(65536)
            if not data:
                break
            capture.write(data)
            capture.flush()
            upstream.sendall(data)
    try:
        upstream.shutdown(socket.SHUT_WR)
    except OSError:
        pass


def inbound():
    while True:
        data = upstream.recv(65536)
        if not data:
            break
        client.sendall(data)
    try:
        client.shutdown(socket.SHUT_WR)
    except OSError:
        pass


outbound_thread = threading.Thread(target=outbound)
inbound_thread = threading.Thread(target=inbound)
outbound_thread.start()
inbound_thread.start()
outbound_thread.join()
inbound_thread.join()

client.close()
upstream.close()
server.close()
PY

python3 proxy.py \
    "$PROXY_SOCK" \
    "$REAL_SOCK" \
    client-to-agent.bin \
    > proxy.log 2>&1 &
PROXY_PID=$!

i=0
while [ ! -S "$PROXY_SOCK" ]; do
    i=$((i + 1))
    [ "$i" -lt 100 ] || exit 1
    sleep .02
done

if ! command -v bwrap >/dev/null 2>&1 ||
    ! bwrap --unshare-net \
        --ro-bind / / \
        --tmpfs /home \
        --dev /dev \
        --proc /proc \
        true >/dev/null 2>&1
then
    echo bwrap_network_isolation=unavailable
    exit 1
fi

NAMESPACE=petition@ecosym.synthetic

bwrap --unshare-net \
    --ro-bind / / \
    --tmpfs /home \
    --bind "$D" "$D" \
    --dev /dev \
    --proc /proc \
    --setenv HOME "$D" \
    --setenv SSH_AUTH_SOCK "$PROXY_SOCK" \
    ssh-keygen -Y sign \
        -f key.pub \
        -n "$NAMESPACE" \
        envelope.jcs \
    > sign.log 2>&1

wait "$PROXY_PID"
PROXY_PID=
[ -s envelope.jcs.sig ]

echo signing_network_isolation=bwrap-unshare-net

python3 - <<'PY'
prompt = open("askpass.log", encoding="utf-8").read().rstrip("\n")
lines = prompt.splitlines()
assert lines

recognized = (
    lines[0].startswith("Allow use of key ")
    and lines[0].endswith("?")
)

print(
    "askpass_prompt_sanitized="
    + (
        "Allow use of key <SYNTHETIC_KEY_IDENTIFIER>?"
        if recognized
        else "<UNRECOGNIZED>"
    )
)
print("askpass_prompt_line_count=" + str(len(lines)))
print(
    "request_marker_in_askpass_prompt="
    + (
        "yes"
        if "ECOSYM_TASK013_UNIQUE_CONTENT_MARKER" in prompt
        else "no"
    )
)
PY

kill "$AGENT_PID"
wait "$AGENT_PID" 2>/dev/null || :
AGENT_PID=

echo agent_stopped_before_verification=yes

awk \
    'BEGIN { p="synthetic-task013-principal" } { print p, $1, $2 }' \
    key.pub > allowed

run_isolated() {
    bwrap --unshare-net \
        --ro-bind / / \
        --tmpfs /home \
        --bind "$D" "$D" \
        --dev /dev \
        --proc /proc \
        --setenv HOME "$D" \
        "$@"
}

run_isolated ssh-keygen -Y verify \
    -f allowed \
    -I synthetic-task013-principal \
    -n "$NAMESPACE" \
    -s envelope.jcs.sig \
    < envelope.jcs > verify.log 2>&1

echo public_only_verification=success

python3 - <<'PY'
data = bytearray(open("envelope.jcs", "rb").read())
offset = data.index(b"ECOSYM_TASK013_UNIQUE_CONTENT_MARKER")
data[offset] = 70 if data[offset] != 70 else 71
open("flipped", "wb").write(data)
PY

[ "$(wc -c < envelope.jcs)" -eq "$(wc -c < flipped)" ]
DIFFS=$(cmp -l envelope.jcs flipped | wc -l)
[ "$DIFFS" -eq 1 ]
echo cmp_difference_count="$DIFFS"

if run_isolated ssh-keygen -Y verify \
    -f allowed \
    -I synthetic-task013-principal \
    -n "$NAMESPACE" \
    -s envelope.jcs.sig \
    < flipped > tamper.log 2>&1
then
    exit 1
else
    echo one_byte_tamper_verification=failed-as-required
fi

ssh-keygen -q -k \
    -f revoked.krl \
    key.pub \
    > krl.log 2>&1

if run_isolated ssh-keygen -Y verify \
    -f allowed \
    -I synthetic-task013-principal \
    -n "$NAMESPACE" \
    -s envelope.jcs.sig \
    -r revoked.krl \
    < envelope.jcs > revoked.log 2>&1
then
    exit 1
else
    echo current_krl_verification=failed-as-required
fi

run_isolated ssh-keygen -Y verify \
    -f allowed \
    -I synthetic-task013-principal \
    -n "$NAMESPACE" \
    -s envelope.jcs.sig \
    < envelope.jcs > historical-policy.log 2>&1

run_isolated ssh-keygen -Y check-novalidate \
    -n "$NAMESPACE" \
    -s envelope.jcs.sig \
    < envelope.jcs > historical-crypto.log 2>&1

echo historical_verification_without_current_krl=success

python3 - <<'PY'
import struct

envelope = open("envelope.jcs", "rb").read()
stream = open("client-to-agent.bin", "rb").read()
marker = b"ECOSYM_TASK013_UNIQUE_CONTENT_MARKER"

sizes = []
offset = 0

while offset < len(stream):
    assert offset + 4 <= len(stream)
    size = struct.unpack(">I", stream[offset:offset + 4])[0]
    offset += 4
    assert offset + size <= len(stream)
    sizes.append(size)
    offset += size

assert offset == len(stream)
assert sizes

print(
    "exact_envelope_in_client_to_agent_stream="
    + ("yes" if envelope in stream else "no")
)
print(
    "request_marker_in_client_to_agent_stream="
    + ("yes" if marker in stream else "no")
)
print("envelope_byte_count=" + str(len(envelope)))
print("client_agent_request_count=" + str(len(sizes)))
print(
    "client_agent_request_payload_max_bytes="
    + str(max(sizes))
)
print(
    "client_agent_request_payload_total_bytes="
    + str(sum(sizes))
)
PY

echo structural_fixture_not_authorizing_petition=yes
echo experiment_status=success
```

## Appendix B: GPG lifecycle probe

Run this saved as a temporary executable script. The outer invocation mounts
the script read-only and gives the sandbox a private `/tmp` tmpfs. Synthetic
credential material is never written into a host scratch directory, and the
tmpfs disappears with the sandbox even if the probe is interrupted.

```bash
#!/usr/bin/env bash
set -u

if [ "${1-}" != --inside ]; then
    bwrap --die-with-parent --unshare-net \
        --ro-bind / / \
        --tmpfs /tmp \
        --dev /dev \
        --proc /proc \
        --ro-bind "$0" /tmp/probe \
        /tmp/probe --inside
    status=$?
    printf 'sandbox_rc=%s cleanup=namespace-destroyed\n' "$status"
    exit "$status"
fi

cd /tmp
umask 077
mkdir -m 700 sign verify-pre verify-current

cat > fake-pinentry <<'PINENTRY'
#!/bin/sh
printf 'invoked\n' >> /tmp/pinentry-invocations
exit 1
PINENTRY
chmod 700 fake-pinentry
printf 'pinentry-program /tmp/fake-pinentry\nallow-loopback-pinentry\n' \
    > sign/gpg-agent.conf

export GNUPGHOME=/tmp/sign
: > pinentry-invocations

gpg --batch --no-tty --pinentry-mode loopback --passphrase '' \
    --quick-generate-key \
    'Ecosym Synthetic Lifecycle <synthetic.invalid>' \
    rsa2048 sign 1d > generate.out 2> generate.err
generate_status=$?

gpg --batch --armor --export > public.asc 2> export.err
export_status=$?

revocation_file=$(find sign/openpgp-revocs.d -type f -print -quit)
sed 's/^://' "$revocation_file" > revocation.asc

printf 'ECOSYM013-UNIQUE-CONTENT-MARKER\000\377END\n' > payload.bin
: > pinentry-invocations

gpg --batch --no-tty --pinentry-mode error --yes --detach-sign \
    --output payload.sig payload.bin > sign.out 2> sign.err
sign_status=$?

pinentry_count=$(awk 'NF { n++ } END { print n + 0 }' pinentry-invocations)
marker_seen=no
grep -aFq 'ECOSYM013-UNIQUE-CONTENT-MARKER' \
    sign.out sign.err pinentry-invocations && marker_seen=yes

printf 'generate_rc=%s export_rc=%s sign_rc=%s confirmation_required=%s pinentry_invocations=%s marker_in_signer_or_pinentry_output=%s\n' \
    "$generate_status" "$export_status" "$sign_status" \
    "$([ "$sign_status" -eq 0 ] && echo no || echo unknown)" \
    "$pinentry_count" "$marker_seen"

gpg --batch --no-tty --import revocation.asc \
    > sign-revoke.out 2> sign-revoke.err
sign_revoke_status=$?

: > pinentry-invocations
gpg --batch --no-tty --pinentry-mode error --yes --detach-sign \
    --output post-revocation.sig payload.bin \
    > post-sign.out 2> post-sign.err
post_sign_status=$?

printf 'signing_home_revocation_import_rc=%s post_revocation_sign_rc=%s post_sign_pinentry_invocations=%s\n' \
    "$sign_revoke_status" "$post_sign_status" \
    "$(awk 'NF { n++ } END { print n + 0 }' pinentry-invocations)"

gpgconf --homedir /tmp/sign --kill gpg-agent >/dev/null 2>&1
rm -rf sign
printf 'signing_home_removed=%s\n' \
    "$(test -e sign && echo no || echo yes)"

for home in verify-pre verify-current; do
    GNUPGHOME=/tmp/$home gpg --batch --no-tty --import public.asc \
        > "$home.import.out" 2> "$home.import.err"
done

GNUPGHOME=/tmp/verify-pre \
    gpg --batch --with-colons --list-secret-keys \
    > pre-secret.out 2> pre-secret.err
secret_records=$(
    awk -F: '$1 == "sec" || $1 == "ssb" { n++ } END { print n + 0 }' \
        pre-secret.out
)

GNUPGHOME=/tmp/verify-pre \
    gpg --batch --no-tty --status-fd=3 \
    --verify payload.sig payload.bin \
    3> pre.status > pre.out 2> pre.err
pre_status=$?
pre_names=$(
    awk '$1 == "[GNUPG:]" { print $2 }' pre.status |
        sort -u |
        paste -sd, -
)

cp payload.bin mutated.bin
printf X | dd of=mutated.bin bs=1 seek=0 conv=notrunc status=none

GNUPGHOME=/tmp/verify-pre \
    gpg --batch --no-tty --status-fd=3 \
    --verify payload.sig mutated.bin \
    3> mutation.status > mutation.out 2> mutation.err
mutation_status=$?
mutation_names=$(
    awk '$1 == "[GNUPG:]" { print $2 }' mutation.status |
        sort -u |
        paste -sd, -
)

printf 'public_only_secret_records=%s pre_revocation_verify_rc=%s status_names=%s one_byte_mutation_verify_rc=%s mutation_status_names=%s\n' \
    "$secret_records" "$pre_status" "$pre_names" \
    "$mutation_status" "$mutation_names"

GNUPGHOME=/tmp/verify-current \
    gpg --batch --no-tty --import revocation.asc \
    > current-import.out 2> current-import.err
revoke_import_status=$?

GNUPGHOME=/tmp/verify-current \
    gpg --batch --no-tty --status-fd=3 \
    --verify payload.sig payload.bin \
    3> current.status > current.out 2> current.err
current_status=$?
current_names=$(
    awk '$1 == "[GNUPG:]" { print $2 }' current.status |
        sort -u |
        paste -sd, -
)

if [ "$current_status" -ne 0 ] ||
    grep -q '^\[GNUPG:\] REVKEYSIG ' current.status ||
    ! grep -q '^\[GNUPG:\] VALIDSIG ' current.status
then
    current_strict_status=1
else
    current_strict_status=0
fi

GNUPGHOME=/tmp/verify-pre \
    gpg --batch --no-tty --status-fd=3 \
    --verify payload.sig payload.bin \
    3> archived.status > archived.out 2> archived.err
archived_status=$?
archived_names=$(
    awk '$1 == "[GNUPG:]" { print $2 }' archived.status |
        sort -u |
        paste -sd, -
)

if [ "$archived_status" -ne 0 ] ||
    grep -q '^\[GNUPG:\] REVKEYSIG ' archived.status ||
    ! grep -q '^\[GNUPG:\] VALIDSIG ' archived.status
then
    archived_strict_status=1
else
    archived_strict_status=0
fi

printf 'revocation_import_rc=%s default_current_verify_rc=%s current_status_names=%s strict_current_rc=%s archived_verify_rc=%s archived_status_names=%s strict_archived_rc=%s\n' \
    "$revoke_import_status" "$current_status" "$current_names" \
    "$current_strict_status" "$archived_status" "$archived_names" \
    "$archived_strict_status"

probe_status=0
[ "$generate_status" -eq 0 ] || probe_status=1
[ "$export_status" -eq 0 ] || probe_status=1
[ "$sign_status" -eq 0 ] || probe_status=1
[ "$pinentry_count" -eq 0 ] || probe_status=1
[ "$marker_seen" = no ] || probe_status=1
[ "$sign_revoke_status" -eq 0 ] || probe_status=1
[ "$post_sign_status" -ne 0 ] || probe_status=1
[ "$secret_records" -eq 0 ] || probe_status=1
[ "$pre_status" -eq 0 ] || probe_status=1
[ "$mutation_status" -ne 0 ] || probe_status=1
[ "$revoke_import_status" -eq 0 ] || probe_status=1
[ "$current_status" -eq 0 ] || probe_status=1
[ "$current_strict_status" -eq 1 ] || probe_status=1
[ "$archived_status" -eq 0 ] || probe_status=1
[ "$archived_strict_status" -eq 0 ] || probe_status=1

inside_cleanup_status=complete
rm -rf sign verify-pre verify-current || inside_cleanup_status=failed
for path in sign verify-pre verify-current; do
    [ ! -e "$path" ] || inside_cleanup_status=failed
done
if [ "$inside_cleanup_status" = failed ]; then
    probe_status=1
fi

printf 'inside_cleanup=%s\n' "$inside_cleanup_status"
exit "$probe_status"
```
