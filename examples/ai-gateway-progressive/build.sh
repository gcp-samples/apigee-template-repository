#!/usr/bin/env bash
# build.sh -- compile all four AFT templates and post-process the resulting
# bundles to work around a bug in the shipping gcloud AFT converter.
#
# ---- The AFT converter bug (worked around here) --------------------------
#
# `converter.proxy_to_bundle` in the shipping Python compiler
# (googlecloudsdk/command_lib/apigee/aft/converter.py) always wraps
# fault-rule steps in a <Request> element:
#
#     <DefaultFaultRule name="FallbackToOpenAI">
#       <Request>                          <-- WRONG: this wrapper prevents
#         <Step><Name>...</Name></Step>          Apigee from picking up the
#       </Request>                                custom fault rule at runtime
#     </DefaultFaultRule>
#
# Apigee expects <Step> children DIRECTLY inside <DefaultFaultRule>
# and <FaultRule>. Without the fix, the built-in DefaultFaultRule is
# used instead of ours, and cross-provider fallback silently no-ops.
#
# This script:
#   1. Runs `converter.proxy_to_bundle` normally.
#   2. Post-processes every .xml in the bundle to unwrap <Request> inside
#      any (Default)FaultRule.
#   3. Writes the fixed bundle to /tmp/stageN-fixed.zip for each stage.
#
# ---- Usage ---------------------------------------------------------------
#
#   ./build.sh
#
# Then import each stage with:
#
#   gcloud beta apigee apis import aft-demo-01-hello-llm \
#     --from-bundle=/tmp/stage01-fixed.zip \
#     --organization=$APIGEE_ORG
#
# (Instead of `--from-template=demo/01-hello-llm.yaml`.)

set -euo pipefail

# Locate the gcloud AFT compiler on this system.
GCLOUD_LIB=""
for candidate in \
    /usr/lib/google-cloud-sdk/lib \
    /google/data/ro/teams/apigee/gcloud-sdk/lib \
    "$(gcloud info --format='value(installation.sdk_root)' 2>/dev/null)/lib"; do
  if [[ -d "${candidate}/googlecloudsdk/command_lib/apigee/aft" ]]; then
    GCLOUD_LIB="${candidate}"
    break
  fi
done
if [[ -z "${GCLOUD_LIB}" ]]; then
  echo "ERROR: could not find gcloud AFT compiler library." >&2
  echo "       Looked in /usr/lib/google-cloud-sdk/lib and gcloud info --sdk_root." >&2
  exit 1
fi

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${OUT_DIR:-/tmp}"

python3 - <<PYEOF
import sys, os, yaml, zipfile, io, re
sys.path.insert(0, '${GCLOUD_LIB}')
from googlecloudsdk.command_lib.apigee.aft import models, compiler, converter

DEMO_DIR = '${DEMO_DIR}'
OUT_DIR = '${OUT_DIR}'

FAULT_RULE_PATTERN = re.compile(
    r'(<(?:Default)?FaultRule[^>]*>)(<AlwaysEnforce>[^<]*</AlwaysEnforce>)?'
    r'<Request>(.*?)</Request>(</(?:Default)?FaultRule>)',
    re.DOTALL,
)

def unwrap_fault_wrapper(xml_bytes):
    """Strip <Request>...</Request> from inside (Default)FaultRule.

    Steps in a fault rule should be direct children -- the AFT converter
    incorrectly wraps them in <Request> which Apigee then does not honor.
    """
    xml = xml_bytes.decode('utf-8')
    def _unwrap(m):
        return f"{m.group(1)}{m.group(2) or ''}{m.group(3)}{m.group(4)}"
    return FAULT_RULE_PATTERN.sub(_unwrap, xml).encode('utf-8')

def compile_and_fix(template_path):
    with open(template_path) as f:
        template = models.from_dict(models.Template, yaml.safe_load(f))
    tmpl_dir = os.path.dirname(template_path) or '.'
    features = [
        models.from_dict(models.Feature, yaml.safe_load(open(os.path.join(tmpl_dir, ff))))
        for ff in template.features
    ]
    proxy = compiler.ApigeeCompiler().compile(template, features, {})
    bundle = converter.proxy_to_bundle(proxy)
    out_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(bundle), 'r') as inp, \
         zipfile.ZipFile(out_buf, 'w', zipfile.ZIP_DEFLATED) as out:
        for info in inp.infolist():
            data = inp.read(info.filename)
            if info.filename.endswith('.xml'):
                data = unwrap_fault_wrapper(data)
            new_info = zipfile.ZipInfo(filename=info.filename)
            new_info.date_time = (1980, 1, 1, 0, 0, 0)
            new_info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(new_info, data)
    return out_buf.getvalue()

templates = [
    ('01-hello-llm.yaml',              '/tmp/stage01-fixed.zip'),
    ('02-add-model-armor.yaml',        '/tmp/stage02-fixed.zip'),
    ('03-add-routing-and-cache.yaml',  '/tmp/stage03-fixed.zip'),
    ('04-add-fallback.yaml',           '/tmp/stage04-fixed.zip'),
]
for tmpl_name, out_name in templates:
    tmpl_path = os.path.join(DEMO_DIR, tmpl_name)
    out_path = os.path.join(OUT_DIR, os.path.basename(out_name))
    bundle = compile_and_fix(tmpl_path)
    with open(out_path, 'wb') as f:
        f.write(bundle)
    print(f'{tmpl_name:45}  ->  {out_path}  ({len(bundle)} bytes)')

print()
print('All bundles written. Import each with:')
print('  gcloud beta apigee apis import <api-name> \\\\')
print('    --from-bundle=/tmp/stageNN-fixed.zip \\\\')
print('    --organization=\$APIGEE_ORG')
PYEOF
