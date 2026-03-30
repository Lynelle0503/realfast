const state = {
  members: [],
  selectedMemberId: null,
  member: null,
  policies: [],
  policyEndpointData: {},
  availablePolicies: [],
  claims: [],
  selectedClaimId: null,
  claim: null,
  disputes: [],
  disputeEndpointData: {},
  rawJsonVisible: false,
  actionMode: 'create',
  sidebarOpen: window.innerWidth > 980,
  demoMemberPanelOpen: false,
  demoMemberMode: 'preset'
};

const els = {
  appShell: document.querySelector('#app-shell'),
  sidebar: document.querySelector('#sidebar'),
  sidebarToggle: document.querySelector('#sidebar-toggle'),
  sidebarClose: document.querySelector('#sidebar-close'),
  memberList: document.querySelector('#member-list'),
  createDemoMemberToggle: document.querySelector('#create-demo-member-toggle'),
  createDemoMemberForm: document.querySelector('#create-demo-member-form'),
  demoMemberModeSwitch: document.querySelector('#demo-member-mode-switch'),
  demoMemberPresetPanel: document.querySelector('#demo-member-preset-panel'),
  demoMemberCustomPanel: document.querySelector('#demo-member-custom-panel'),
  demoMemberTemplate: document.querySelector('#demo-member-template'),
  demoMemberFullName: document.querySelector('#demo-member-full-name'),
  demoMemberDateOfBirth: document.querySelector('#demo-member-date-of-birth'),
  createDemoMember: document.querySelector('#create-demo-member'),
  memberTitle: document.querySelector('#member-title'),
  memberSubtitle: document.querySelector('#member-subtitle'),
  memberDetail: document.querySelector('#member-detail'),
  policyList: document.querySelector('#policy-list'),
  claimList: document.querySelector('#claim-list'),
  claimTitle: document.querySelector('#claim-title'),
  claimDetail: document.querySelector('#claim-detail'),
  rawJsonToggle: document.querySelector('#raw-json-toggle'),
  rawJson: document.querySelector('#raw-json'),
  submitClaimForm: document.querySelector('#submit-claim-form'),
  actionModeSwitch: document.querySelector('#action-mode-switch'),
  createActionsPanel: document.querySelector('#create-actions-panel'),
  updateActionsPanel: document.querySelector('#update-actions-panel'),
  submitPolicyId: document.querySelector('#submit-policy-id'),
  submitClaimNote: document.querySelector('#submit-claim-note'),
  providerId: document.querySelector('#provider-id'),
  providerName: document.querySelector('#provider-name'),
  diagnosisCodes: document.querySelector('#diagnosis-codes'),
  lineItemsEditor: document.querySelector('#line-items-editor'),
  addLineItem: document.querySelector('#add-line-item'),
  adjudicateClaim: document.querySelector('#adjudicate-claim'),
  manualReviewForm: document.querySelector('#manual-review-form'),
  manualReviewLine: document.querySelector('#manual-review-line'),
  manualReviewDecision: document.querySelector('#manual-review-decision'),
  paymentForm: document.querySelector('#payment-form'),
  payableLines: document.querySelector('#payable-lines'),
  disputeForm: document.querySelector('#dispute-form'),
  disputeReason: document.querySelector('#dispute-reason'),
  disputeNote: document.querySelector('#dispute-note'),
  disputeLineItems: document.querySelector('#dispute-line-items'),
  toast: document.querySelector('#toast')
};

const demoMemberTemplates = [
  { fullName: 'Anaya Singh', dateOfBirth: '1994-08-12' },
  { fullName: 'Kabir Patel', dateOfBirth: '1989-11-03' },
  { fullName: 'Neha Iyer', dateOfBirth: '1991-06-27' },
  { fullName: 'Vihaan Kapoor', dateOfBirth: '1987-02-14' }
];

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.background = isError ? '#7f1d1d' : '#111827';
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const message = body?.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCurrency(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return Number(value).toFixed(2);
}

function badge(status) {
  return `<span class="badge ${status}">${status.replaceAll('_', ' ')}</span>`;
}

function reasonForLine(lineItem) {
  return state.claim?.lineDecisions.find((decision) => decision.lineItemId === lineItem.lineItemId) ?? null;
}

function claimsForPolicy(policyId) {
  return state.claims.filter((claim) => claim.policyId === policyId);
}

function policyForClaim(claim) {
  return state.policies.find((policy) => policy.policyId === claim.policyId) ?? null;
}

function renderEndpointJson(path, payload) {
  if (!payload) {
    return `
      <details class="endpoint-json">
        <summary>${escapeHtml(path)}</summary>
        <p class="muted">Endpoint data is not available yet.</p>
      </details>
    `;
  }

  return `
    <details class="endpoint-json">
      <summary>${escapeHtml(path)}</summary>
      <pre class="raw-json endpoint-json-body">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </details>
  `;
}

function claimStatusExplanation(claim) {
  if (claim.status === 'submitted') {
    return 'This claim has been submitted but not adjudicated yet.';
  }

  if (claim.status === 'under_review') {
    const manualReviewLines = claim.lineItems.filter((lineItem) => lineItem.status === 'manual_review');
    if (manualReviewLines.length > 0) {
      return `This claim is under review because ${manualReviewLines.map((lineItem) => lineItem.lineItemId).join(', ')} still need manual review.`;
    }

    const unresolvedLines = claim.lineItems.filter((lineItem) => lineItem.status === 'submitted');
    if (unresolvedLines.length > 0) {
      return `This claim is under review because ${unresolvedLines.map((lineItem) => lineItem.lineItemId).join(', ')} have not been finalized yet.`;
    }

    return 'This claim is still under review because not every line item has reached a final state.';
  }

  if (claim.status === 'approved') {
    const deniedLines = claim.lineItems.filter((lineItem) => lineItem.status === 'denied');
    if (deniedLines.length > 0) {
      return `This claim is approved because adjudication is complete, even though ${deniedLines.length} line item(s) were denied.`;
    }

    return 'This claim is approved because all line items have reached a final decision.';
  }

  if (claim.status === 'paid') {
    return 'This claim is paid because every approved line item has been marked paid.';
  }

  return 'Claim status is available.';
}

function nextActionText(claim) {
  if (!claim) {
    return 'Select a claim to see the next available action.';
  }

  if (claim.lineItems.some((lineItem) => lineItem.status === 'submitted')) {
    return 'Next step: adjudicate this claim.';
  }

  if (claim.lineItems.some((lineItem) => lineItem.status === 'manual_review')) {
    return 'Next step: resolve the manual review line items.';
  }

  if (claim.lineItems.some((lineItem) => lineItem.status === 'approved')) {
    return 'Next step: mark approved line items as paid.';
  }

  if (claim.lineItems.some((lineItem) => lineItem.status === 'denied')) {
    return 'Optional next step: open a dispute for denied line items.';
  }

  return 'This claim has completed its current flow.';
}

function flowStepClass(claimStatus, step) {
  const order = ['submitted', 'under_review', 'approved', 'paid'];
  const claimIndex = order.indexOf(claimStatus);
  const stepIndex = order.indexOf(step);

  if (claimIndex === stepIndex) {
    return 'current';
  }

  if (claimIndex > stepIndex) {
    return 'complete';
  }

  return '';
}

function renderStepper(claimStatus) {
  const steps = [
    { key: 'submitted', label: 'Submitted' },
    { key: 'under_review', label: 'Under review' },
    { key: 'approved', label: 'Approved' },
    { key: 'paid', label: 'Paid' }
  ];

  return `
    <div class="stepper">
      ${steps
        .map(
          (step) => `
            <div class="stepper-step ${flowStepClass(claimStatus, step.key)}">
              <span class="stepper-dot"></span>
              <span class="stepper-label">${step.label}</span>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function optionalExplanationRow(label, value) {
  if (value === null || value === undefined || value === '' || value === 'n/a') {
    return '';
  }

  return `<div><strong>${label}</strong>: ${escapeHtml(value)}</div>`;
}

function renderMemberList() {
  if (state.members.length === 0) {
    els.memberList.innerHTML = '<p class="empty-state">No members found. Seed demo data or create a demo member.</p>';
    return;
  }

  els.memberList.innerHTML = state.members
    .map(
      (member) => `
        <button type="button" class="member-button ${member.memberId === state.selectedMemberId ? 'active' : ''}" data-member-id="${member.memberId}">
          <strong>${escapeHtml(member.fullName)}</strong>
          <span>${escapeHtml(member.memberId)}</span>
        </button>
      `
    )
    .join('');

  els.memberList.querySelectorAll('[data-member-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await selectMember(button.getAttribute('data-member-id'));
      if (window.innerWidth <= 980) {
        toggleSidebar(false);
      }
    });
  });
}

function isMobileLayout() {
  return window.innerWidth <= 980;
}

function renderSidebar() {
  const isMobile = isMobileLayout();
  els.appShell.classList.toggle('sidebar-collapsed', !state.sidebarOpen);
  els.appShell.classList.toggle('sidebar-expanded', state.sidebarOpen);
  els.sidebar.classList.toggle('open', isMobile && state.sidebarOpen);
  els.sidebarToggle.setAttribute('aria-expanded', String(state.sidebarOpen));
  els.sidebarToggle.setAttribute('aria-label', state.sidebarOpen ? 'Hide members sidebar' : 'Show members sidebar');
  els.sidebarClose.classList.toggle('hidden', !isMobile && !state.sidebarOpen);
}

function toggleSidebar(forceOpen) {
  state.sidebarOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.sidebarOpen;
  renderSidebar();
}

function renderDemoMemberCreator() {
  els.createDemoMemberForm.classList.toggle('hidden', !state.demoMemberPanelOpen);
  els.createDemoMemberToggle.textContent = state.demoMemberPanelOpen ? 'Close' : 'Open';
  els.demoMemberPresetPanel.classList.toggle('hidden', state.demoMemberMode !== 'preset');
  els.demoMemberCustomPanel.classList.toggle('hidden', state.demoMemberMode !== 'custom');

  els.demoMemberModeSwitch.querySelectorAll('[data-demo-member-mode]').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-demo-member-mode') === state.demoMemberMode);
  });
}

function buildDemoPolicyPayload() {
  return {
    policyType: 'Health PPO',
    effectiveDate: '2026-01-01',
    coverageRules: {
      benefitPeriod: 'policy_year',
      deductible: 0,
      coinsurancePercent: 80,
      annualOutOfPocketMax: 3000,
      serviceRules: [
        { serviceCode: 'office_visit', covered: true, yearlyDollarCap: 1000, yearlyVisitCap: 10 },
        { serviceCode: 'lab_test', covered: true, yearlyDollarCap: 500, yearlyVisitCap: null },
        { serviceCode: 'prescription', covered: false, yearlyDollarCap: null, yearlyVisitCap: null }
      ]
    }
  };
}

function getDemoMemberPayload() {
  if (state.demoMemberMode === 'preset') {
    const template = demoMemberTemplates.find((item) => item.fullName === els.demoMemberTemplate.value) ?? demoMemberTemplates[0];
    return template;
  }

  const fullName = els.demoMemberFullName.value.trim();
  const dateOfBirth = els.demoMemberDateOfBirth.value;

  if (!fullName || !dateOfBirth) {
    throw new Error('Enter both full name and date of birth for a custom demo member.');
  }

  return { fullName, dateOfBirth };
}

function renderActionMode() {
  els.createActionsPanel.classList.toggle('hidden', state.actionMode !== 'create');
  els.updateActionsPanel.classList.toggle('hidden', state.actionMode !== 'update');

  els.actionModeSwitch.querySelectorAll('[data-action-mode]').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-action-mode') === state.actionMode);
  });
}

function renderMemberDetail() {
  if (!state.member) {
    els.memberTitle.textContent = 'No member selected';
  els.memberSubtitle.textContent = 'Pick a seeded member to inspect policy coverage and claims.';
  els.memberDetail.innerHTML = '<p class="empty-state">Member details appear here.</p>';
  els.policyList.innerHTML = '<p class="empty-state">No policy selected.</p>';
  els.claimList.innerHTML = '<p class="empty-state">No claims loaded.</p>';
    return;
  }

  els.memberTitle.textContent = state.member.fullName;
  els.memberSubtitle.textContent = `${state.member.memberId} · DOB ${state.member.dateOfBirth}`;
  els.memberDetail.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card"><span>Policies</span><strong>${state.policies.length}</strong></div>
      <div class="summary-card"><span>Claims</span><strong>${state.claims.length}</strong></div>
      <div class="summary-card"><span>Claim-eligible policies</span><strong>${state.availablePolicies.length}</strong></div>
    </div>
  `;

  els.policyList.innerHTML =
    state.policies.length === 0
      ? '<p class="empty-state">No policies for this member.</p>'
      : state.policies
          .map((policy) => {
            const policyClaims = claimsForPolicy(policy.policyId);
            const selectedClaimForPolicy = state.claim?.policyId === policy.policyId ? state.claim : null;
            const policyEndpoint = state.policyEndpointData[policy.policyId] ?? null;

            return `
              <article class="simple-card">
                <div class="section-row">
                  <div>
                    <strong>${escapeHtml(policy.policyType)}</strong>
                    <div class="muted">${escapeHtml(policy.policyId)} · Effective ${escapeHtml(policy.effectiveDate)}</div>
                  </div>
                  <div class="policy-meta">Deductible ${formatCurrency(policy.coverageRules.deductible)} · Coinsurance ${policy.coverageRules.coinsurancePercent}%</div>
                </div>
                <div class="coverage-table-wrap">
                  <table class="coverage-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Coverage</th>
                        <th>Dollar cap</th>
                        <th>Visit cap</th>
                        <th>Selected claim impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${policy.coverageRules.serviceRules
                        .map((rule, index) => {
                          const matchedLineItems =
                            selectedClaimForPolicy?.lineItems.filter((lineItem) => lineItem.serviceCode === rule.serviceCode) ?? [];
                          const impactText =
                            matchedLineItems.length === 0
                              ? 'No matching line item'
                              : matchedLineItems
                                  .map((lineItem) => {
                                    const decision = reasonForLine(lineItem);
                                    const outcome =
                                      decision?.reasonText ??
                                      (rule.covered ? 'Covered by policy rule.' : 'Not covered by policy rule.');
                                    return `${lineItem.lineItemId}: ${outcome}`;
                                  })
                                  .join(' ');

                          return `
                            <tr class="${index % 2 === 1 ? 'alt-row' : ''} ${rule.covered ? '' : 'not-covered-row'}">
                              <td>${escapeHtml(rule.serviceCode)}</td>
                              <td>${rule.covered ? 'Covered' : 'Not covered'}</td>
                              <td>${rule.yearlyDollarCap ?? 'None'}</td>
                              <td>${rule.yearlyVisitCap ?? 'None'}</td>
                              <td>${escapeHtml(impactText)}</td>
                            </tr>
                          `;
                        })
                        .join('')}
                    </tbody>
                  </table>
                </div>
                <div class="policy-claims">
                  <strong>Claims on this policy</strong>
                  ${
                    policyClaims.length === 0
                      ? '<p class="muted">No claims submitted on this policy yet.</p>'
                      : policyClaims
                          .map(
                            (claim) => `
                              <button type="button" class="claim-link ${claim.claimId === state.selectedClaimId ? 'active' : ''}" data-claim-id="${claim.claimId}">
                                <span>${escapeHtml(claim.claimId)}</span>
                                ${badge(claim.status)}
                              </button>
                            `
                          )
                          .join('')
                  }
                </div>
                ${renderEndpointJson(`/api/v1/policies/${policy.policyId}`, policyEndpoint)}
              </article>
            `;
          })
          .join('');

  els.policyList.querySelectorAll('[data-claim-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await selectClaim(button.getAttribute('data-claim-id'));
    });
  });

  els.claimList.innerHTML =
    state.claims.length === 0
      ? '<p class="empty-state">No claims for this member yet.</p>'
      : state.claims
          .map((claim) => {
            const policy = policyForClaim(claim);
            return `
              <button type="button" class="claim-flow-card ${claim.claimId === state.selectedClaimId ? 'active' : ''}" data-claim-id="${claim.claimId}">
                <strong>${escapeHtml(claim.claimId)}</strong>
                <div class="muted">${escapeHtml(policy?.policyId ?? claim.policyId)} · approved lines ${claim.approvedLineItemCount}</div>
                ${renderStepper(claim.status)}
              </button>
            `;
          })
          .join('');

  els.claimList.querySelectorAll('[data-claim-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await selectClaim(button.getAttribute('data-claim-id'));
    });
  });

  els.submitPolicyId.innerHTML = state.availablePolicies
    .map((policy) => `<option value="${policy.policyId}">${policy.policyId} · ${escapeHtml(policy.policyType)}</option>`)
    .join('');

  const submitButton = els.submitClaimForm.querySelector('button[type="submit"]');
  if (state.availablePolicies.length === 0) {
    els.submitClaimNote.textContent =
      'This member already has a claim on each policy. Create a demo member + policy to submit a new claim flow.';
    submitButton.disabled = true;
  } else {
    els.submitClaimNote.textContent = 'Submit one new claim against an unused policy for this member.';
    submitButton.disabled = false;
  }
}

function renderClaimDetail() {
  if (!state.claim) {
    els.claimTitle.textContent = 'No claim selected';
    els.claimDetail.innerHTML = '<p class="empty-state">Select a claim to see the policy flow and line-by-line decisions.</p>';
    els.rawJson.classList.add('hidden');
    return;
  }

  const policy = policyForClaim(state.claim);
  const disputeSection =
    state.disputes.length === 0
      ? '<p class="muted">No disputes have been opened for this claim.</p>'
      : state.disputes
          .map(
            (dispute) => `
              <div class="stack endpoint-card">
                <div class="simple-row">
                  <span>${escapeHtml(dispute.disputeId)}</span>
                  ${badge(dispute.status)}
                </div>
                ${renderEndpointJson(`/api/v1/disputes/${dispute.disputeId}`, state.disputeEndpointData[dispute.disputeId] ?? null)}
              </div>
            `
          )
          .join('');

  els.claimTitle.textContent = `${state.claim.claimId} · ${state.claim.provider.name}`;
  els.claimDetail.innerHTML = `
    ${renderStepper(state.claim.status)}

    <div class="summary-grid">
      <div class="summary-card"><span>Current step</span><strong>${state.claim.status.replaceAll('_', ' ')}</strong></div>
      <div class="summary-card"><span>Approved lines</span><strong>${state.claim.approvedLineItemCount}</strong></div>
      <div class="summary-card"><span>Policy</span><strong>${escapeHtml(policy?.policyId ?? state.claim.policyId)}</strong></div>
    </div>

    <article class="simple-card">
      <strong>Why this status</strong>
      <p>${escapeHtml(claimStatusExplanation(state.claim))}</p>
      <p class="muted">${escapeHtml(nextActionText(state.claim))}</p>
    </article>

    <article class="simple-card">
      <strong>Claim context</strong>
      <div class="simple-row"><span>Provider</span><span>${escapeHtml(state.claim.provider.name)} (${escapeHtml(state.claim.provider.providerId)})</span></div>
      <div class="simple-row"><span>Diagnosis codes</span><span>${escapeHtml(state.claim.diagnosisCodes.join(', ') || 'none')}</span></div>
      <div class="simple-row"><span>Disputes</span><span>${state.disputes.length}</span></div>
    </article>

    <article class="simple-card">
      <strong>Line-by-line decisions</strong>
      <div class="stack">
        ${state.claim.lineItems
          .map((lineItem) => {
            const decision = reasonForLine(lineItem);
            return `
              <details class="accordion-item" ${lineItem.lineItemId === state.claim.lineItems[0].lineItemId ? 'open' : ''}>
                <summary class="accordion-summary">
                  <div>
                    <strong>${escapeHtml(lineItem.description)}</strong>
                    <div class="muted">${escapeHtml(lineItem.lineItemId)} · ${escapeHtml(lineItem.serviceCode)}</div>
                  </div>
                  <div class="accordion-meta">
                    ${badge(lineItem.status)}
                  </div>
                </summary>
                <div class="accordion-body">
                  <div class="amount-grid">
                    <div class="amount-card">
                      <span>Billed</span>
                      <strong>${formatCurrency(lineItem.billedAmount)}</strong>
                    </div>
                    <div class="amount-card">
                      <span>Payer</span>
                      <strong>${formatCurrency(decision?.payerAmount)}</strong>
                    </div>
                    <div class="amount-card">
                      <span>Member</span>
                      <strong>${formatCurrency(decision?.memberResponsibility)}</strong>
                    </div>
                  </div>
                  ${
                    decision
                      ? `
                        <div class="explanation-box">
                          <div><strong>Decision</strong>: ${escapeHtml(decision.decision)}</div>
                          ${optionalExplanationRow('Reason code', decision.reasonCode)}
                          ${optionalExplanationRow('Reason text', decision.reasonText)}
                          ${optionalExplanationRow('Next step', decision.memberNextStep)}
                        </div>
                      `
                      : ''
                  }
                </div>
              </details>
            `;
          })
          .join('')}
      </div>
    </article>

    <article class="simple-card">
      <strong>Disputes</strong>
      ${disputeSection}
    </article>
  `;

  if (state.rawJsonVisible) {
    els.rawJson.textContent = JSON.stringify(
      {
        claim: state.claim,
        disputes: state.disputes,
        policyEndpoint: state.policyEndpointData[state.claim.policyId] ?? null,
        disputeEndpoints: state.disputeEndpointData
      },
      null,
      2
    );
    els.rawJson.classList.remove('hidden');
  } else {
    els.rawJson.classList.add('hidden');
  }
}

function renderActionForms() {
  const manualReviewLines = state.claim?.lineItems.filter((lineItem) => lineItem.status === 'manual_review') ?? [];
  const approvedLines = state.claim?.lineItems.filter((lineItem) => lineItem.status === 'approved') ?? [];
  const disputableLines = state.claim?.lineItems.filter((lineItem) => lineItem.status === 'denied') ?? [];

  els.adjudicateClaim.disabled = !state.claim || !state.claim.lineItems.some((lineItem) => lineItem.status === 'submitted');

  els.manualReviewLine.innerHTML =
    manualReviewLines.length === 0
      ? '<option value="">No manual review lines</option>'
      : manualReviewLines
          .map((lineItem) => `<option value="${lineItem.lineItemId}">${lineItem.lineItemId} · ${escapeHtml(lineItem.description)}</option>`)
          .join('');
  els.manualReviewForm.querySelector('button').disabled = manualReviewLines.length === 0;

  els.payableLines.innerHTML =
    approvedLines.length === 0
      ? '<p class="empty-state">No approved lines are ready for payment.</p>'
      : approvedLines
          .map(
            (lineItem) => `
              <label class="checkbox-row">
                <input type="checkbox" name="pay-line-item" value="${lineItem.lineItemId}" checked />
                <span>${escapeHtml(lineItem.lineItemId)} · ${escapeHtml(lineItem.description)}</span>
              </label>
            `
          )
          .join('');
  els.paymentForm.querySelector('button').disabled = approvedLines.length === 0;

  els.disputeLineItems.innerHTML =
    disputableLines.length === 0
      ? '<p class="empty-state">No denied lines are available for dispute.</p>'
      : disputableLines
          .map(
            (lineItem) => `
              <label class="checkbox-row">
                <input type="checkbox" name="dispute-line-item" value="${lineItem.lineItemId}" />
                <span>${escapeHtml(lineItem.lineItemId)} · ${escapeHtml(lineItem.description)}</span>
              </label>
            `
          )
          .join('');
  els.disputeForm.querySelector('button').disabled = !state.claim;
}

function addLineItemRow(initial = { serviceCode: 'office_visit', description: 'Consultation', billedAmount: '120' }) {
  const row = document.createElement('div');
  row.className = 'line-item-editor';
  row.innerHTML = `
    <label>Service code<input name="serviceCode" type="text" value="${escapeHtml(initial.serviceCode)}" required /></label>
    <label>Description<input name="description" type="text" value="${escapeHtml(initial.description)}" required /></label>
    <label>Billed amount<input name="billedAmount" type="number" min="0" step="0.01" value="${escapeHtml(initial.billedAmount)}" required /></label>
    <button type="button" class="secondary">Remove</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
  });
  els.lineItemsEditor.appendChild(row);
}

function getClaimPayloadFromForm() {
  const lineItems = [...els.lineItemsEditor.querySelectorAll('.line-item-editor')].map((row) => ({
    serviceCode: row.querySelector('[name="serviceCode"]').value.trim(),
    description: row.querySelector('[name="description"]').value.trim(),
    billedAmount: Number(row.querySelector('[name="billedAmount"]').value)
  }));

  return {
    memberId: state.selectedMemberId,
    policyId: els.submitPolicyId.value,
    provider: {
      providerId: els.providerId.value.trim(),
      name: els.providerName.value.trim()
    },
    diagnosisCodes: els.diagnosisCodes.value
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    lineItems
  };
}

async function loadMembers() {
  const body = await api('/api/v1/members');
  state.members = body.items;
  renderMemberList();

  if (state.members.length > 0) {
    await selectMember(state.selectedMemberId ?? state.members[0].memberId);
  } else {
    state.policyEndpointData = {};
    state.disputeEndpointData = {};
    renderMemberDetail();
    renderClaimDetail();
    renderActionForms();
  }
}

async function selectMember(memberId) {
  if (!memberId) {
    return;
  }

  state.selectedMemberId = memberId;
  const [member, policiesResponse, claimsResponse] = await Promise.all([
    api(`/api/v1/members/${memberId}`),
    api(`/api/v1/members/${memberId}/policies`),
    api(`/api/v1/members/${memberId}/claims`)
  ]);
  const policyEndpointEntries = await Promise.all(
    policiesResponse.items.map(async (policy) => [policy.policyId, await api(`/api/v1/policies/${policy.policyId}`)])
  );

  state.member = member;
  state.policies = policiesResponse.items;
  state.policyEndpointData = Object.fromEntries(policyEndpointEntries);
  state.claims = claimsResponse.items;
  state.availablePolicies = state.policies.filter(
    (policy) => !state.claims.some((claim) => claim.policyId === policy.policyId)
  );
  state.disputeEndpointData = {};
  renderMemberList();
  renderMemberDetail();

  if (state.claims.length > 0) {
    const nextClaimId =
      state.selectedClaimId && state.claims.some((claim) => claim.claimId === state.selectedClaimId)
        ? state.selectedClaimId
        : state.claims[0].claimId;
    await selectClaim(nextClaimId);
  } else {
    state.selectedClaimId = null;
    state.claim = null;
    state.disputes = [];
    state.disputeEndpointData = {};
    renderClaimDetail();
    renderActionForms();
  }

  if (state.availablePolicies.length > 0 && !state.selectedClaimId) {
    state.actionMode = 'create';
  }

  renderActionMode();
}

async function selectClaim(claimId) {
  if (!claimId) {
    return;
  }

  state.selectedClaimId = claimId;
  const [claim, disputesResponse] = await Promise.all([
    api(`/api/v1/claims/${claimId}`),
    api(`/api/v1/claims/${claimId}/disputes`)
  ]);
  const [policyEndpoint, disputeEndpointEntries] = await Promise.all([
    api(`/api/v1/policies/${claim.policyId}`),
    Promise.all(
      disputesResponse.items.map(async (dispute) => [
        dispute.disputeId,
        await api(`/api/v1/disputes/${dispute.disputeId}`)
      ])
    )
  ]);

  state.claim = claim;
  state.disputes = disputesResponse.items;
  state.policyEndpointData = {
    ...state.policyEndpointData,
    [claim.policyId]: policyEndpoint
  };
  state.disputeEndpointData = Object.fromEntries(disputeEndpointEntries);
  renderMemberDetail();
  renderClaimDetail();
  renderActionForms();
  state.actionMode = 'update';
  renderActionMode();
}

els.rawJsonToggle.addEventListener('change', () => {
  state.rawJsonVisible = els.rawJsonToggle.checked;
  renderClaimDetail();
});

els.sidebarToggle.addEventListener('click', () => {
  toggleSidebar();
});

els.sidebarClose.addEventListener('click', () => {
  toggleSidebar(false);
});

els.createDemoMemberToggle.addEventListener('click', () => {
  state.demoMemberPanelOpen = !state.demoMemberPanelOpen;
  renderDemoMemberCreator();
});

els.demoMemberModeSwitch.querySelectorAll('[data-demo-member-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.demoMemberMode = button.getAttribute('data-demo-member-mode');
    renderDemoMemberCreator();
  });
});

els.actionModeSwitch.querySelectorAll('[data-action-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.actionMode = button.getAttribute('data-action-mode');
    renderActionMode();
  });
});

els.addLineItem.addEventListener('click', () => addLineItemRow());

els.submitClaimForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const claim = await api('/api/v1/claims', {
      method: 'POST',
      body: JSON.stringify(getClaimPayloadFromForm())
    });
    showToast(`Created ${claim.claimId}`);
    await selectMember(state.selectedMemberId);
    await selectClaim(claim.claimId);
  } catch (error) {
    showToast(error.message, true);
  }
});

els.createDemoMemberForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const memberPayload = getDemoMemberPayload();
    const member = await api('/api/v1/members', {
      method: 'POST',
      body: JSON.stringify(memberPayload)
    });

    await api(`/api/v1/members/${member.memberId}/policies`, {
      method: 'POST',
      body: JSON.stringify(buildDemoPolicyPayload())
    });

    if (state.demoMemberMode === 'custom') {
      els.demoMemberFullName.value = '';
      els.demoMemberDateOfBirth.value = '';
    }
    state.demoMemberPanelOpen = false;
    renderDemoMemberCreator();
    showToast(`Created ${member.memberId} with a fresh demo policy.`);
    await loadMembers();
    await selectMember(member.memberId);
  } catch (error) {
    showToast(error.message, true);
  }
});

els.adjudicateClaim.addEventListener('click', async () => {
  if (!state.claim) {
    showToast('Select a claim first.', true);
    return;
  }

  try {
    const response = await api(`/api/v1/claims/${state.claim.claimId}/adjudications`, { method: 'POST' });
    showToast(`Adjudicated ${response.claim.claimId}`);
    await selectMember(state.selectedMemberId);
    await selectClaim(state.claim.claimId);
  } catch (error) {
    showToast(error.message, true);
  }
});

els.manualReviewForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.claim || !els.manualReviewLine.value) {
    showToast('No manual review line selected.', true);
    return;
  }

  try {
    await api(`/api/v1/claims/${state.claim.claimId}/line-items/${els.manualReviewLine.value}/review-decisions`, {
      method: 'POST',
      body: JSON.stringify({ decision: els.manualReviewDecision.value })
    });
    showToast('Manual review resolved.');
    await selectMember(state.selectedMemberId);
    await selectClaim(state.claim.claimId);
  } catch (error) {
    showToast(error.message, true);
  }
});

els.paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.claim) {
    showToast('Select a claim first.', true);
    return;
  }

  const lineItemIds = [...els.payableLines.querySelectorAll('input[name="pay-line-item"]:checked')].map((input) => input.value);
  if (lineItemIds.length === 0) {
    showToast('Select at least one approved line to pay.', true);
    return;
  }

  try {
    await api(`/api/v1/claims/${state.claim.claimId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ lineItemIds })
    });
    showToast('Payment recorded.');
    await selectMember(state.selectedMemberId);
    await selectClaim(state.claim.claimId);
  } catch (error) {
    showToast(error.message, true);
  }
});

els.disputeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.claim) {
    showToast('Select a claim first.', true);
    return;
  }

  const referencedLineItemIds = [...els.disputeLineItems.querySelectorAll('input[name="dispute-line-item"]:checked')].map((input) => input.value);

  try {
    await api(`/api/v1/claims/${state.claim.claimId}/disputes`, {
      method: 'POST',
      body: JSON.stringify({
        reason: els.disputeReason.value.trim(),
        note: els.disputeNote.value.trim() || undefined,
        referencedLineItemIds
      })
    });
    showToast('Dispute opened.');
    await selectClaim(state.claim.claimId);
  } catch (error) {
    showToast(error.message, true);
  }
});

addLineItemRow();
addLineItemRow({ serviceCode: 'lab_test', description: 'Rapid strep test', billedAmount: '80' });

els.demoMemberTemplate.innerHTML = demoMemberTemplates
  .map((template) => `<option value="${template.fullName}">${escapeHtml(template.fullName)} · DOB ${escapeHtml(template.dateOfBirth)}</option>`)
  .join('');

renderSidebar();
renderDemoMemberCreator();

window.addEventListener('resize', () => {
  renderSidebar();
});

void loadMembers().catch((error) => {
  showToast(error.message, true);
});
