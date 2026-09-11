/**
 * Apigee Template & Feature Documentation Viewer
 * Minimalist monochrome single-page vanilla JS app
 */

(function() {
  'use strict';

  // --- Theme Management ---
  const themeToggle = document.getElementById('theme-toggle');

  function getActiveTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('apigee-docs-theme', theme);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = getActiveTheme();
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('apigee-docs-theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });

  // --- Elements ---
  const catalogSelect = document.getElementById('catalog-select');
  const customUrlInput = document.getElementById('custom-url-input');
  const loadUrlBtn = document.getElementById('load-url-btn');
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const resetBtn = document.getElementById('reset-btn');
  const docContent = document.getElementById('doc-content');

  const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/gcp-samples/apigee-template-repository/main/';
  const DEFAULT_DEF = 'features/ai-endpoint-completions.yaml';
  let currentFileOrUrl = '';

  // --- URL & Parameter Handling ---
  function getRequestedTarget() {
    const params = new URLSearchParams(window.location.search);
    const file = params.get('file');
    const url = params.get('url');
    if (file) return file;
    if (url) return url;
    if (window.location.hash) {
      return window.location.hash.replace(/^#/, '');
    }
    return DEFAULT_DEF;
  }

  function updateBrowserUrl(target) {
    const isUrl = /^https?:\/\//i.test(target);
    const paramKey = isUrl ? 'url' : 'file';
    const newUrl = `${window.location.pathname}?${paramKey}=${encodeURIComponent(target)}`;
    window.history.pushState({ target }, '', newUrl);
  }

  // --- Fetching Logic with Fallbacks ---
  async function fetchYaml(target) {
    showLoading();

    // 1. Direct absolute URL
    if (/^https?:\/\//i.test(target)) {
      try {
        const res = await fetch(target);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return await res.text();
      } catch (err) {
        throw new Error(`Failed to fetch from URL: ${err.message}`);
      }
    }

    // Clean relative path (remove leading slash or ./ or ../)
    const cleanPath = target.replace(/^(\.\/|\/)+/, '');

    // Potential locations to try
    const candidates = [
      `../${cleanPath}`,
      cleanPath,
      `${GITHUB_RAW_BASE}${cleanPath}`
    ];

    let lastError = null;
    for (const cand of candidates) {
      try {
        const res = await fetch(cand);
        if (res.ok) {
          return await res.text();
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`Could not load YAML from "${cleanPath}". (Checked relative paths and GitHub raw fallback). ${lastError ? lastError.message : ''}`);
  }

  // --- UI State Management ---
  function showLoading() {
    loadingState.classList.remove('hidden');
    errorState.classList.add('hidden');
    docContent.classList.add('hidden');
  }

  function showError(title, msg) {
    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');
    docContent.classList.add('hidden');
    errorTitle.textContent = title;
    errorMessage.textContent = msg;
  }

  function showContent() {
    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');
    docContent.classList.remove('hidden');
  }

  // --- Escape HTML Helper ---
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Main Loader ---
  async function loadDefinition(target, updateUrl = true) {
    if (!target) target = DEFAULT_DEF;
    currentFileOrUrl = target;

    if (customUrlInput) customUrlInput.value = target;
    if (catalogSelect) {
      catalogSelect.value = target;
      if (!catalogSelect.value && !/^https?:\/\//i.test(target)) {
        // Look for matching option ignoring prefix
        for (const opt of catalogSelect.options) {
          if (opt.value && target.endsWith(opt.value)) {
            catalogSelect.value = opt.value;
            break;
          }
        }
      }
    }

    if (updateUrl) {
      updateBrowserUrl(target);
    }

    try {
      const rawText = await fetchYaml(target);
      if (typeof jsyaml === 'undefined') {
        throw new Error('YAML parser (js-yaml) not ready yet. Please refresh the page.');
      }
      const data = jsyaml.load(rawText);
      renderDocumentation(data, rawText, target);
      showContent();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showError('Failed to load definition', err.message);
    }
  }

  // --- Documentation Renderer ---
  function renderDocumentation(data, rawYaml, target) {
    if (!data || typeof data !== 'object') {
      showError('Invalid Definition', 'The fetched file does not contain a valid YAML object.');
      return;
    }

    const type = (data.type || 'feature').toLowerCase();
    const fileBaseName = target.split('/').pop().replace(/\.ya?ml$/i, '');
    const title = data.displayName || data.name || fileBaseName;
    const secondaryIdentifier = (data.name && data.name !== title) ? data.name : (title !== fileBaseName ? fileBaseName : '');
    const description = data.description || 'No description provided.';
    const gateway = data.gateway || 'apigee';
    const schemaVersion = data.schemaVersion || '1.0.0';
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const documentation = data.documentation || '';

    const parameters = Array.isArray(data.parameters) ? data.parameters : [];
    const features = Array.isArray(data.features) ? data.features : [];

    // Combine explicit endpoints with defaultEndpoint if present
    const endpoints = [];
    if (data.defaultEndpoint) {
      endpoints.push({ ...data.defaultEndpoint, isDefault: true });
    }
    if (Array.isArray(data.endpoints)) {
      endpoints.push(...data.endpoints);
    }

    // Combine explicit targets with defaultTarget if present
    const targets = [];
    if (data.defaultTarget) {
      targets.push({ ...data.defaultTarget, isDefault: true });
    }
    if (Array.isArray(data.targets)) {
      targets.push(...data.targets);
    }

    const policies = Array.isArray(data.policies) ? data.policies : [];
    const resources = Array.isArray(data.resources) ? data.resources : [];

    // Calculate total flows count
    let totalFlows = 0;
    endpoints.forEach(ep => {
      if (Array.isArray(ep.flows)) totalFlows += ep.flows.length;
    });
    targets.forEach(tgt => {
      if (Array.isArray(tgt.flows)) totalFlows += tgt.flows.length;
    });

    let html = `
      <!-- Hero Header -->
      <section class="doc-hero">
        <div class="doc-meta-tags">
          <span class="badge">${esc(type)}</span>
          <span class="badge badge-outline">${esc(gateway)}</span>
          <span class="badge badge-outline">v${esc(schemaVersion)}</span>
          ${categories.map(c => `<span class="badge badge-outline">${esc(c)}</span>`).join('')}
        </div>
        <h1 class="doc-title">${esc(title)}</h1>
        ${secondaryIdentifier ? `<p class="doc-display-name"><code>${esc(secondaryIdentifier)}</code></p>` : ''}
        <p class="doc-desc">${esc(description)}</p>

        <div class="doc-actions">
          <button class="btn-secondary" id="action-copy-path" data-path="${esc(target)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Reference
          </button>
          <button class="btn-secondary" id="action-toggle-yaml">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
            Toggle Raw YAML
          </button>
          ${documentation ? `
            <a href="${esc(documentation)}" target="_blank" rel="noopener" class="btn-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              External Docs
            </a>
          ` : ''}
        </div>

        <!-- Metrics Overview -->
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-value">${parameters.length}</div>
            <div class="metric-label">Parameters</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${endpoints.length}</div>
            <div class="metric-label">Endpoints</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${targets.length}</div>
            <div class="metric-label">Targets</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${policies.length}</div>
            <div class="metric-label">Policies</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${totalFlows}</div>
            <div class="metric-label">Flow Steps</div>
          </div>
        </div>
      </section>

      <!-- Collapsible Raw YAML -->
      <section id="raw-yaml-section" class="raw-yaml-section hidden">
        <div class="section-header">
          <h2 class="section-title">Source Definition</h2>
          <button class="btn-copy" id="btn-copy-yaml">Copy YAML</button>
        </div>
        <div class="code-box">
          <div class="code-box-header"><span>${esc(target)}</span></div>
          <pre id="raw-yaml-code"><code>${esc(rawYaml)}</code></pre>
        </div>
      </section>
    `;

    // --- Bundled Features (Template) ---
    if (type === 'template' && features.length > 0) {
      html += `
        <section class="doc-section">
          <div class="section-header">
            <h2 class="section-title">Bundled Features <span class="section-count">(${features.length})</span></h2>
          </div>
          <p class="state-text" style="margin-bottom: 0.75rem;">This template bundles and orchestrates the following modular feature extensions:</p>
          <div class="feature-chips">
            ${features.map(f => {
              // Normalize relative link
              const cleanF = f.replace(/^\.\.\//, '');
              return `<a href="?file=${encodeURIComponent(cleanF)}" class="feature-chip" data-file="${esc(cleanF)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                ${esc(cleanF)}
              </a>`;
            }).join('')}
          </div>
        </section>
      `;
    }

    // --- Parameters Section ---
    html += `
      <section class="doc-section">
        <div class="section-header">
          <h2 class="section-title">Parameters <span class="section-count">(${parameters.length})</span></h2>
        </div>
        ${parameters.length > 0 ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Type</th>
                  <th>Default Value</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                ${parameters.map(p => `
                  <tr>
                    <td><strong>${esc(p.name || 'unnamed')}</strong> ${p.required ? '<span class="badge" style="font-size: 0.65rem; padding: 0.1rem 0.3rem;">Required</span>' : ''}</td>
                    <td><span class="code-badge">${esc(p.type || 'string')}</span></td>
                    <td>${p.default !== undefined ? `<span class="code-badge">${esc(p.default)}</span>` : '<span style="color: var(--text-muted);">&mdash;</span>'}</td>
                    <td>${esc(p.description || p.displayName || 'No description provided.')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="state-text" style="text-align: left;">No configurable parameters declared.</p>`}
      </section>
    `;

    // --- Endpoints & Processing Flows ---
    html += `
      <section class="doc-section">
        <div class="section-header">
          <h2 class="section-title">Proxy Endpoints &amp; Flows <span class="section-count">(${endpoints.length})</span></h2>
        </div>
        ${endpoints.length > 0 ? `
          <div class="card-stack">
            ${endpoints.map(ep => renderEndpointCard(ep)).join('')}
          </div>
        ` : `<p class="state-text" style="text-align: left;">No proxy endpoints declared in this definition.</p>`}
      </section>
    `;

    // --- Upstream Targets ---
    html += `
      <section class="doc-section">
        <div class="section-header">
          <h2 class="section-title">Upstream Targets <span class="section-count">(${targets.length})</span></h2>
        </div>
        ${targets.length > 0 ? `
          <div class="card-stack">
            ${targets.map(tgt => renderTargetCard(tgt)).join('')}
          </div>
        ` : `<p class="state-text" style="text-align: left;">No explicit upstream targets declared (no-target or dynamic routing).</p>`}
      </section>
    `;

    // --- Policies & Processing Steps ---
    html += `
      <section class="doc-section">
        <div class="section-header">
          <h2 class="section-title">Policies &amp; Processing Steps <span class="section-count">(${policies.length})</span></h2>
        </div>
        ${policies.length > 0 ? `
          <div class="card-stack">
            ${policies.map(pol => renderPolicyCard(pol)).join('')}
          </div>
        ` : `<p class="state-text" style="text-align: left;">No standalone policies declared in this definition.</p>`}
      </section>
    `;

    // --- Resources Section (if any) ---
    if (resources.length > 0) {
      html += `
        <section class="doc-section">
          <div class="section-header">
            <h2 class="section-title">Resources <span class="section-count">(${resources.length})</span></h2>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Resource Name</th>
                  <th>Type</th>
                  <th>Path / URI</th>
                </tr>
              </thead>
              <tbody>
                ${resources.map(res => `
                  <tr>
                    <td><strong>${esc(res.name || 'unnamed')}</strong></td>
                    <td><span class="code-badge">${esc(res.type || 'script')}</span></td>
                    <td><span class="code-badge">${esc(res.path || res.uri || '')}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    html += renderExampleCommands(title, type, target, endpoints);

    docContent.innerHTML = html;

    // Attach dynamic listeners
    attachDocListeners(rawYaml, target);
  }

  // --- Endpoint Renderer ---
  function renderEndpointCard(ep) {
    const flows = Array.isArray(ep.flows) ? ep.flows : [];
    const routes = Array.isArray(ep.routes) ? ep.routes : [];
    const faultRules = Array.isArray(ep.faultRules) ? ep.faultRules : [];

    return `
      <div class="item-card">
        <div class="item-card-header">
          <div>
            <span class="badge" style="margin-right: 0.5rem;">${ep.isDefault ? 'Default Endpoint' : 'Endpoint'}</span>
            <span class="item-title">${esc(ep.name || 'default')}</span>
          </div>
          <div>
            <span class="code-badge" style="font-weight: 600;">${esc(ep.basePath || '/')}</span>
          </div>
        </div>

        ${routes.length > 0 ? `
          <div style="margin-top: 0.85rem;">
            <div class="flow-title">Routes (${routes.length})</div>
            <div class="table-wrapper" style="margin-top: 0.4rem;">
              <table>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Target Destination</th>
                    <th>Condition Rule</th>
                  </tr>
                </thead>
                <tbody>
                  ${routes.map(r => `
                    <tr>
                      <td><strong>${esc(r.name || 'default')}</strong></td>
                      <td><span class="code-badge">${esc(r.target || 'none')}</span></td>
                      <td>${r.condition ? `<span class="step-condition">${esc(r.condition)}</span>` : '<span style="color: var(--text-muted);">&mdash;</span>'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        ${flows.length > 0 ? `
          <div class="flow-container">
            <div class="flow-title">Flow Execution Steps</div>
            ${flows.map(f => renderFlowSteps(f)).join('')}
          </div>
        ` : ''}

        ${ep.defaultFaultRule ? `
          <div class="flow-container">
            <div class="flow-title">Default Fault Rule: ${esc(ep.defaultFaultRule.name || 'default-fault')}</div>
            <ul class="step-list">
              ${(ep.defaultFaultRule.steps || []).map((step, idx) => `
                <li class="step-item">
                  <span class="step-num">${idx + 1}.</span>
                  <div class="step-content">
                    <span class="step-name">${esc(step.name)}</span>
                    ${step.condition ? `<span class="step-condition">${esc(step.condition)}</span>` : ''}
                  </div>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  // --- Target Renderer ---
  function renderTargetCard(tgt) {
    const flows = Array.isArray(tgt.flows) ? tgt.flows : [];
    const faultRules = Array.isArray(tgt.faultRules) ? tgt.faultRules : [];

    return `
      <div class="item-card">
        <div class="item-card-header">
          <div>
            <span class="badge" style="margin-right: 0.5rem;">${tgt.isDefault ? 'Default Target' : 'Target'}</span>
            <span class="item-title">${esc(tgt.name || 'default')}</span>
          </div>
          <div>
            <span class="code-badge">${esc(tgt.url || 'No URL')}</span>
          </div>
        </div>

        ${flows.length > 0 ? `
          <div class="flow-container">
            <div class="flow-title">Target Flows</div>
            ${flows.map(f => renderFlowSteps(f)).join('')}
          </div>
        ` : ''}

        ${faultRules.length > 0 ? `
          <div class="flow-container">
            <div class="flow-title">Fault Rules (${faultRules.length})</div>
            ${faultRules.map(fr => `
              <div style="margin-bottom: 0.5rem;">
                <div style="font-size: 0.82rem; font-weight: 600; font-family: var(--font-mono);">${esc(fr.name)}</div>
                <ul class="step-list" style="margin-top: 0.25rem;">
                  ${(fr.steps || []).map((step, idx) => `
                    <li class="step-item">
                      <span class="step-num">${idx + 1}.</span>
                      <div class="step-content">
                        <span class="step-name">${esc(step.name)}</span>
                        ${step.condition ? `<span class="step-condition">${esc(step.condition)}</span>` : ''}
                      </div>
                    </li>
                  `).join('')}
                </ul>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  // --- Flow Steps Renderer ---
  function renderFlowSteps(flow) {
    const steps = Array.isArray(flow.steps) ? flow.steps : [];
    return `
      <div style="border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.75rem; background-color: var(--bg-surface);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <strong style="font-size: 0.85rem; font-family: var(--font-mono);">${esc(flow.name || 'Flow')}</strong>
          <span class="badge" style="font-size: 0.65rem;">${esc(flow.mode || 'Request')}</span>
        </div>
        ${steps.length > 0 ? `
          <ul class="step-list">
            ${steps.map((step, idx) => `
              <li class="step-item">
                <span class="step-num">${idx + 1}.</span>
                <div class="step-content">
                  <span class="step-name">${esc(step.name)}</span>
                  ${step.condition ? `<span class="step-condition">${esc(step.condition)}</span>` : ''}
                </div>
              </li>
            `).join('')}
          </ul>
        ` : '<span style="font-size: 0.8rem; color: var(--text-muted);">No steps attached to this flow.</span>'}
      </div>
    `;
  }

  // --- Policy Card Renderer ---
  function renderPolicyCard(policy) {
    const name = policy.name || 'UnnamedPolicy';
    const type = policy.type || 'Unknown';
    const content = policy.content || {};

    let contentSnippet = '';
    try {
      contentSnippet = jsyaml.dump(content);
    } catch {
      contentSnippet = JSON.stringify(content, null, 2);
    }

    return `
      <div class="item-card">
        <div class="item-card-header">
          <div>
            <span class="badge" style="margin-right: 0.5rem;">${esc(type)}</span>
            <span class="item-title">${esc(name)}</span>
          </div>
        </div>
        ${contentSnippet.trim() ? `
          <div class="code-box">
            <div class="code-box-header"><span>Configuration</span></div>
            <pre><code>${esc(contentSnippet.trim())}</code></pre>
          </div>
        ` : ''}
      </div>
    `;
  }

  // --- Example Commands Renderer ---
  function renderExampleCommands(name, type, target, endpoints) {
    const isTemplate = type === 'template';
    let sampleBasePath = '/v1/chat/completions';
    if (endpoints.length > 0 && endpoints[0].basePath) {
      sampleBasePath = endpoints[0].basePath.replace(/\{[^}]+\}/g, 'default');
    }

    const deployCmd = `aft ${target} \\
  --organization="$APIGEE_ORG" \\
  --environment="$APIGEE_ENV" \\
  --service-account="$APIGEE_SA"`;

    const describeCmd = `aft describe ${target}`;

    const curlCmd = `curl -X POST "https://\${APIGEE_HOST}${sampleBasePath}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \$(gcloud auth print-access-token)" \\
  -d '{
    "model": "google/gemini-2.5-flash",
    "prompt": "Hello Apigee!"
  }'`;

    return `
      <section class="doc-section">
        <div class="section-header">
          <h2 class="section-title">Commands &amp; Usage Examples</h2>
        </div>

        <div style="display: flex; flex-direction: column; gap: 1.25rem;">
          <div>
            <div class="flow-title">1. Deploy with aft CLI</div>
            <div class="code-box">
              <div class="code-box-header"><span>Shell Command</span></div>
              <pre><code>${esc(deployCmd)}</code></pre>
            </div>
          </div>

          <div>
            <div class="flow-title">2. Describe Definition</div>
            <div class="code-box">
              <div class="code-box-header"><span>Shell Command</span></div>
              <pre><code>${esc(describeCmd)}</code></pre>
            </div>
          </div>

          <div>
            <div class="flow-title">3. Test via cURL</div>
            <div class="code-box">
              <div class="code-box-header"><span>API Request</span></div>
              <pre><code>${esc(curlCmd)}</code></pre>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  // --- Document Event Listeners ---
  function attachDocListeners(rawYaml, target) {
    const copyPathBtn = document.getElementById('action-copy-path');
    if (copyPathBtn) {
      copyPathBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(target).then(() => {
          copyPathBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyPathBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Copy Reference
            `;
          }, 2000);
        });
      });
    }

    const toggleYamlBtn = document.getElementById('action-toggle-yaml');
    const rawYamlSection = document.getElementById('raw-yaml-section');
    if (toggleYamlBtn && rawYamlSection) {
      toggleYamlBtn.addEventListener('click', () => {
        rawYamlSection.classList.toggle('hidden');
        if (!rawYamlSection.classList.contains('hidden')) {
          rawYamlSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    const copyYamlBtn = document.getElementById('btn-copy-yaml');
    if (copyYamlBtn) {
      copyYamlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(rawYaml).then(() => {
          copyYamlBtn.textContent = 'Copied!';
          setTimeout(() => { copyYamlBtn.textContent = 'Copy YAML'; }, 2000);
        });
      });
    }

    // Intercept feature chip clicks
    document.querySelectorAll('.feature-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const file = chip.getAttribute('data-file');
        if (file) loadDefinition(file, true);
      });
    });
  }

  // --- Global Event Listeners ---
  if (catalogSelect) {
    catalogSelect.addEventListener('change', () => {
      if (catalogSelect.value) {
        loadDefinition(catalogSelect.value, true);
      }
    });
  }

  if (loadUrlBtn && customUrlInput) {
    loadUrlBtn.addEventListener('click', () => {
      const val = customUrlInput.value.trim();
      if (val) loadDefinition(val, true);
    });
    customUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = customUrlInput.value.trim();
        if (val) loadDefinition(val, true);
      }
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      loadDefinition(currentFileOrUrl || DEFAULT_DEF, false);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      loadDefinition(DEFAULT_DEF, true);
    });
  }

  window.addEventListener('popstate', (e) => {
    const target = getRequestedTarget();
    loadDefinition(target, false);
  });

  // --- Initial Page Load ---
  const initialTarget = getRequestedTarget();
  loadDefinition(initialTarget, false);

})();
