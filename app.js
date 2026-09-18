(() => {
  "use strict";

  const candidateOrder = [
    { id: "gladunov", name: "Гладунов Юрий Николаевич", short: "Юрий Гладунов" },
    { id: "dudoladov", name: "Дудоладов Глеб Борисович", short: "Глеб Дудоладов" },
    { id: "zverev", name: "Зверев Артём Александрович", short: "Артём Зверев" },
    { id: "lugovskoy", name: "Луговской Роман Андреевич", short: "Роман Луговской" }
  ];

  // Only claims explicitly assigned here enter the public comparison table.
  // Unassigned rows remain available in the source ledger and are not silently
  // treated as an answer to an issue question.
  const issueClaimIds = {
    ISS01: [],
    ISS02: ["73"],
    ISS03: ["22", "83", "85"],
    ISS04: ["78", "79"],
    ISS05: ["70", "74", "75"],
    ISS06: ["79"],
    ISS07: ["70", "72", "94"],
    ISS08: ["23", "24", "84", "95"]
  };

  const state = {
    candidates: [],
    candidateById: new Map(),
    claims: [],
    claimsById: new Map(),
    issues: [],
    longread: null,
    selectedCandidates: new Set(candidateOrder.map((candidate) => candidate.id)),
    topic: "all",
    evidence: "all",
    search: "",
    allIssuesOpen: false
  };

  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:"].includes(url.protocol)) return "#";
      return escapeHtml(url.href);
    } catch (_error) {
      return "#";
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }

    const headers = rows.shift() || [];
    return rows.map((values) => headers.reduce((object, header, index) => {
      object[header] = values[index] ?? "";
      return object;
    }, {}));
  }

  function classifyAttribution(row) {
    const text = `${row.uroven_atributsii} ${row.tip_istochnika} ${row.zametka}`.toLowerCase();
    if (text.includes("партийн") || text.includes("партийный")) return "party";
    if (text.includes("соавтор") || text.includes("коллектив") || text.includes("совмест")) return "collective";
    if (text.includes("сми") || text.includes("журналист") || text.includes("переданное СМИ".toLowerCase())) return "media";
    if (text.includes("личн") || text.includes("официальн") || text.includes("реестр")) return "personal";
    return "registry";
  }

  function attributionLabel(type) {
    return {
      personal: "Личное",
      collective: "Вместе",
      party: "Партия",
      media: "СМИ",
      registry: "Официальная запись"
    }[type] || "Источник";
  }

  function candidateIdFromName(name) {
    const candidate = candidateOrder.find((item) => item.name === name);
    return candidate ? candidate.id : null;
  }

  function parseCandidates(raw) {
    const sourceCandidates = raw?.candidates || [];
    return candidateOrder.map((orderItem) => {
      const source = sourceCandidates.find((candidate) => candidate.full_name === orderItem.name) || {};
      return { ...orderItem, ...source };
    });
  }

  function issueClaims(issueId) {
    const ids = issueClaimIds[issueId] || [];
    return ids.map((id) => state.claimsById.get(id)).filter(Boolean);
  }

  function candidateStatus(count) {
    if (count === 1) return "Показан 1 кандидат.";
    if (count < 5) return `Показаны ${count} кандидата.`;
    return `Показаны ${count} кандидатов.`;
  }

  function renderTopCandidateFilter() {
    const filter = $("#candidate-filter");
    if (!filter) return;
    filter.innerHTML = candidateOrder.map((orderItem) => {
      const candidate = state.candidateById.get(orderItem.id) || orderItem;
      const checked = state.selectedCandidates.has(orderItem.id);
      return `<label class="candidate-filter-option">
        <input type="checkbox" data-candidate="${escapeHtml(orderItem.id)}" ${checked ? "checked" : ""}>
        <span><strong>${escapeHtml(candidate.short)}</strong><small>${escapeHtml(candidate.party || "Партия не указана")}</small></span>
      </label>`;
    }).join("");
    const count = state.selectedCandidates.size;
    const status = $("#candidate-filter-status");
    if (status) {
      status.textContent = count === candidateOrder.length
        ? `Показаны все ${count} кандидата.`
        : candidateStatus(count);
    }
  }

  function rerenderFilteredViews() {
    renderTopCandidateFilter();
    renderLongread();
    renderComparison();
    renderCandidates();
    renderLedger();
  }

  function rowMatchesFilters(row) {
    const candidateId = candidateIdFromName(row.kandidat);
    if (candidateId && !state.selectedCandidates.has(candidateId)) return false;

    const attribution = classifyAttribution(row);
    if (state.evidence === "personal" && !["personal", "collective"].includes(attribution)) return false;
    if (state.evidence === "party" && attribution !== "party") return false;
    if (state.evidence === "needs-review" && !row.status.toLowerCase().includes("уточнить") && !row.status.toLowerCase().includes("не найден")) return false;

    const search = state.search.trim().toLowerCase();
    if (search) {
      const haystack = [row.tema, row.utverzhdenie, row.citata, row.kandidat, row.istochnik].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }

  function renderSource(row) {
    return `<a class="source-link" href="${safeUrl(row.source_url)}" target="_blank" rel="noopener" aria-label="Открыть источник: ${escapeHtml(row.istochnik)}">Открыть источник</a>`;
  }

  function hostLabel(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      const names = {
        "assembly.spb.ru": "сайт ЗакСа",
        "cprfspb.ru": "сайт КПРФ",
        "fontanka.ru": "Фонтанка",
        "ideputat.er.ru": "Мой депутат",
        "instagram.com": "Instagram",
        "kprf.ru": "сайт КПРФ",
        "spb.er.ru": "сайт Единой России",
        "spb.ldpr.ru": "сайт ЛДПР",
        "vk.com": "VK",
        "www.instagram.com": "Instagram",
        "www.zaks.ru": "ЗакС.Ру",
        "zaks.ru": "ЗакС.Ру"
      };
      return names[host] || host;
    } catch (_error) {
      return "страница";
    }
  }

  function renderExternalSource(url, label, ariaLabel = label) {
    return `<a class="external-source" href="${safeUrl(url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(label)}</a>`;
  }

  function renderClaim(row) {
    const attribution = classifyAttribution(row);
    const status = row.status.toLowerCase().includes("уточнить") || row.status.toLowerCase().includes("не найден") ? "needs-review" : "";
    return `<div class="evidence-cell ${attribution === "party" ? "is-party" : ""}">
      <div class="evidence-name">
        <strong>${escapeHtml(candidateOrder.find((item) => item.name === row.kandidat)?.short || row.kandidat)}</strong>
        <span class="party-name">${escapeHtml(row.data)}</span>
      </div>
      <span class="badge badge-${escapeHtml(attribution)}">${escapeHtml(attributionLabel(attribution))}</span>
      <p>${escapeHtml(row.utverzhdenie)}</p>
      ${row.citata ? `<p class="quote">${escapeHtml(row.citata)}</p>` : ""}
      <div class="evidence-meta">
        ${status ? `<span class="badge badge-muted">Нужно уточнить</span>` : ""}
        ${row.scope ? `<span class="badge badge-muted">${escapeHtml(row.scope)}</span>` : ""}
      </div>
      ${renderSource(row)}
    </div>`;
  }

  function renderEmpty(candidate, message) {
    return `<div class="evidence-cell is-empty">
      <div class="evidence-name">
        <strong>${escapeHtml(candidate.short)}</strong>
        <span class="party-name">${escapeHtml(candidate.party || "")}</span>
      </div>
      <span class="badge badge-muted">Личный ответ не найден</span>
      <p class="empty-note">${escapeHtml(message)}</p>
    </div>`;
  }

  function renderLedger() {
    const ledger = $("#ledger-list");
    if (!ledger) return;
    const visibleClaims = state.claims.filter((row) => row.kandidat === "все" || state.selectedCandidates.has(candidateIdFromName(row.kandidat)));
    $("#ledger-count").textContent = `(${visibleClaims.length} записей)`;
    ledger.innerHTML = visibleClaims.map((row) => {
      const attribution = classifyAttribution(row);
      const subject = row.kandidat === "все" ? "Общие сведения" : row.kandidat;
      return `<article class="ledger-entry">
        <div class="ledger-entry-head">
          <strong>${escapeHtml(subject)}</strong>
          <span class="badge badge-${escapeHtml(attribution)}">${escapeHtml(attributionLabel(attribution))}</span>
        </div>
        <p class="ledger-topic">${escapeHtml(row.tema)} · ${escapeHtml(row.data)}</p>
        <p>${escapeHtml(row.utverzhdenie)}</p>
        ${row.citata ? `<p class="quote">${escapeHtml(row.citata)}</p>` : ""}
        <div class="ledger-entry-foot">
          <span class="badge badge-muted">${escapeHtml(row.status || "статус не указан")}</span>
          ${renderSource(row)}
        </div>
      </article>`;
    }).join("");
  }

  function setAllIssuesOpen(open) {
    state.allIssuesOpen = open;
    document.querySelectorAll("#comparison-list details.issue-card").forEach((issue) => {
      issue.open = open;
    });
    const toggle = $("#disclosure-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Свернуть все темы" : "Показать все темы";
    }
  }

  function renderComparison() {
    const list = $("#comparison-list");
    const selectedIssues = state.topic === "all" ? state.issues : state.issues.filter((issue) => issue.issue_id === state.topic);
    const cards = [];
    let visibleClaims = 0;

    selectedIssues.forEach((issue) => {
      const claims = issueClaims(issue.issue_id).filter(rowMatchesFilters);
      const issueText = `${issue.category} ${issue.question_text}`.toLowerCase();
      if (state.search && !issueText.includes(state.search.trim().toLowerCase()) && claims.length === 0) return;
      visibleClaims += claims.length;

      const byCandidate = new Map();
      claims.forEach((claim) => {
        const id = candidateIdFromName(claim.kandidat);
        if (!id) return;
        if (!byCandidate.has(id)) byCandidate.set(id, []);
        byCandidate.get(id).push(claim);
      });

      const cells = candidateOrder
        .filter((candidate) => state.selectedCandidates.has(candidate.id))
        .map((candidate) => {
          const candidateClaims = byCandidate.get(candidate.id) || [];
          if (!candidateClaims.length) {
            const allCandidateClaims = issueClaims(issue.issue_id).filter((row) => candidateIdFromName(row.kandidat) === candidate.id);
            const hasActiveFilter = state.evidence !== "all" || state.search.trim() !== "";
            let message = "В проверенных источниках личного ответа по этой теме не найдено. Это не значит «против».";
            if (hasActiveFilter && allCandidateClaims.length) {
              message = "Запись есть, но не подходит под текущий фильтр. Измените фильтр, чтобы увидеть её.";
            } else if (allCandidateClaims.length && allCandidateClaims.every((row) => classifyAttribution(row) === "party")) {
              message = "Личного ответа не найдено. Есть только информация о партии.";
            }
            return renderEmpty({ ...candidate, party: state.candidateById.get(candidate.id)?.party }, message);
          }
          return candidateClaims.map(renderClaim).join("");
        }).join("");

      cards.push(`<details class="issue-card" data-issue-id="${escapeHtml(issue.issue_id)}"${state.allIssuesOpen ? " open" : ""}>
        <summary class="issue-summary">
          <span class="issue-summary-copy">
            <span class="issue-code">${escapeHtml(issue.issue_id)}</span>
            <span>
              <span class="issue-title" role="heading" aria-level="3">${escapeHtml(issue.question_text)}</span>
              <span class="issue-competence">${escapeHtml(issue.assembly_competence_note)}</span>
            </span>
          </span>
        </summary>
        <p class="issue-source">${renderExternalSource(issue.competence_source_url, "Почему это относится к ЗакСу", `Почему тема «${issue.category}» относится к ЗакСу`)}</p>
        <div class="evidence-grid">${cells}</div>
      </details>`);
    });

    list.innerHTML = cards.length ? cards.join("") : `<div class="error-card">Ничего не найдено. Попробуйте выбрать «Все записи» или очистить поиск.</div>`;
    $("#compare-status").textContent = `Тем: ${cards.length} · записей: ${visibleClaims}. Пустая ячейка — не ответ «против».`;
  }

  function shortRole(candidate) {
    const tracks = [];
    if (candidate.single_mandate_constituency) tracks.push(`Кандидат по округу №${candidate.single_mandate_constituency}`);
    if (candidate.regional_group) tracks.push("Также участвует по списку партии");
    if (candidate.state_duma_constituency) tracks.push(`Кандидат в Госдуму по округу №${candidate.state_duma_constituency}`);
    return tracks.join(" · ");
  }

  function isPartyContext(text) {
    const value = String(text || "").toLowerCase();
    return ["единая россия", "лдпр", "кпрф", "парт", "райком", "районного отделения", "секретарь политсовета", "координатор"].some((token) => value.includes(token));
  }

  function renderItems(items, emptyText = "Отдельной записи нет.") {
    const values = (items || []).filter(Boolean);
    return values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="profile-empty">${escapeHtml(emptyText)}</p>`;
  }

  function renderProfileLinks(urls, candidate, limit = null) {
    const values = [...new Set((urls || []).filter((url) => typeof url === "string" && /^https?:\/\//.test(url)))];
    const visible = limit ? values.slice(0, limit) : values;
    return visible.length ? `<ul class="profile-links">${visible.map((url) => `<li>${renderExternalSource(url, `Открыть страницу (${hostLabel(url)})`, `Открыть источник профиля ${candidate.short}`)}</li>`).join("")}</ul>` : `<p class="profile-empty">Источник не указан в профиле.</p>`;
  }

  function renderSocial(candidate) {
    const social = candidate.social || {};
    const personal = [];
    const party = [];
    const labels = { vk: "VK", max: "MAX", ok: "Одноклассники", telegram: "Telegram", facebook: "Facebook", x: "X", instagram: "Instagram" };
    Object.entries(social).forEach(([key, value]) => {
      if (typeof value === "string" && /^https?:\/\//.test(value)) {
        (key === "party_profile" || key === "party_channels" ? party : personal).push({ label: labels[key] || key, url: value });
      } else if (Array.isArray(value)) {
        value.filter((url) => typeof url === "string" && /^https?:\/\//.test(url)).forEach((url) => party.push({ label: key === "party_channels" ? "Партийный канал" : "Партийный профиль", url }));
      }
    });
    const personalHtml = personal.length ? `<ul class="profile-links">${personal.map((item) => `<li><span>${escapeHtml(item.label)}:</span> ${renderExternalSource(item.url, "открыть страницу", `Открыть публичную страницу ${candidate.short}`)}</li>`).join("")}</ul>` : `<p class="profile-empty">В проверенных источниках личная публичная страница не найдена.</p>`;
    const partyHtml = party.length ? `<ul class="profile-links">${party.map((item) => `<li><span>${escapeHtml(item.label)}:</span> ${renderExternalSource(item.url, "открыть страницу", `Открыть партийную страницу ${candidate.short}`)}</li>`).join("")}</ul>` : "";
    return `<div class="profile-subsection"><strong>Личные публичные страницы</strong>${personalHtml}</div>${partyHtml ? `<div class="profile-subsection"><strong>Страницы партии</strong>${partyHtml}</div>` : ""}`;
  }

  function renderSvoAudit(candidate) {
    const audit = candidate.svo_audit || {};
    const found = audit.personal_confirmation === "найдено";
    const auditSources = found ? audit.source_urls : audit.party_context_urls;
    const checked = audit.checked_search_urls || [];
    return `<div class="audit-note ${found ? "audit-found" : "audit-empty"}">
      <strong>Отдельный поиск по теме СВО</strong>
      <p>${found ? "Личное подтверждение найдено." : "Личное подтверждение не найдено в проверенных источниках. Это не значит, что события не было."}</p>
      ${auditSources?.length ? `<span class="profile-label">Источники</span>${renderProfileLinks(auditSources, candidate)}` : ""}
      ${!found && checked.length ? `<span class="profile-label">Проверенные страницы</span>${renderProfileLinks(checked, candidate)}` : ""}
    </div>`;
  }

  function renderCandidateRecords(rows) {
    return `<details class="profile-records">
      <summary>Все записи о кандидате (${rows.length})</summary>
      <div class="profile-record-list">${rows.map((row) => `<article class="profile-record">
        <div class="ledger-entry-head"><strong>${escapeHtml(row.tema)}</strong><span class="badge badge-${escapeHtml(classifyAttribution(row))}">${escapeHtml(attributionLabel(classifyAttribution(row)))}</span></div>
        <p>${escapeHtml(row.utverzhdenie)}</p>
        ${row.citata ? `<p class="quote">${escapeHtml(row.citata)}</p>` : ""}
        <div class="ledger-entry-foot"><span class="badge badge-muted">${escapeHtml(row.status || "статус не указан")}</span>${renderSource(row)}</div>
      </article>`).join("")}</div>
    </details>`;
  }

  function claimKindLabel(row) {
    const labels = {
      биография: "Биография",
      поступок: "Действие",
      действие: "Действие",
      взгляд: "Высказывание",
      кампания: "Кампания",
      контекст: "Общий контекст",
      "партийный контекст": "Партийный контекст",
      бизнес: "Бизнес",
      финансирование: "Финансы",
      "финансовые сведения": "Финансы",
      "проверка атрибуции": "Проверка источника",
      "контакт с жителями": "Обращения жителей"
    };
    return labels[row.tip] || "Запись";
  }

  function renderLongreadClaim(row) {
    const candidate = candidateOrder.find((item) => item.name === row.kandidat);
    const subject = row.kandidat === "все" ? "Общие сведения" : (candidate?.short || row.kandidat);
    const attribution = classifyAttribution(row);
    return `<article class="longread-claim ${attribution === "party" ? "is-party" : ""} ">
      <div class="longread-claim-head">
        <div>
          <strong>${escapeHtml(subject)}</strong>
          <span class="longread-claim-meta">${escapeHtml(row.data || "Дата не указана")} · ${escapeHtml(claimKindLabel(row))}</span>
        </div>
        <span class="badge badge-${escapeHtml(attribution)}">${escapeHtml(attributionLabel(attribution))}</span>
      </div>
      <p class="longread-claim-text">${escapeHtml(row.utverzhdenie)}</p>
      ${row.citata ? `<blockquote>${escapeHtml(row.citata)}</blockquote>` : ""}
      <div class="longread-claim-foot">
        <span class="badge badge-muted">${escapeHtml(row.status || "Статус не указан")}</span>
        ${renderSource(row)}
      </div>
    </article>`;
  }

  function renderLongreadClaimGroup(title, lead, rows) {
    if (!rows.length) return "";
    return `<section class="longread-subsection">
      <h4>${escapeHtml(title)}</h4>
      ${lead ? `<p class="longread-subsection-lead">${escapeHtml(lead)}</p>` : ""}
      <div class="longread-claims">${rows.map(renderLongreadClaim).join("")}</div>
    </section>`;
  }

  function configThemesForTimeline() {
    return state.longread?.timeline_themes || [];
  }

  function renderLongreadTimeline() {
    const rows = state.claims
      .filter((row) => row.kandidat !== "все" && state.selectedCandidates.has(candidateIdFromName(row.kandidat)) && row.data && /^2026/.test(row.data) && configThemesForTimeline().includes(row.tema))
      .sort((a, b) => String(a.data).localeCompare(String(b.data)));
    if (!rows.length) return "";
    return `<section id="longread-timeline" class="longread-chapter">
      <div class="longread-chapter-heading"><p class="eyebrow">Глава 2</p><h3>Хронология кампании</h3><p>Здесь события стоят по времени. Если событие относится к одному кандидату или партии, это указано в самой записи.</p></div>
      <div class="longread-timeline">${rows.map((row) => `<div class="timeline-item"><span class="timeline-date">${escapeHtml(row.data)}</span>${renderLongreadClaim(row)}</div>`).join("")}</div>
    </section>`;
  }

  function renderLongread() {
    const config = state.longread;
    if (!config) return;
    const intro = $("#longread-intro");
    const toc = $("#longread-toc");
    const content = $("#longread-content");
    if (!intro || !toc || !content) return;

    intro.innerHTML = `<p class="longread-kicker">${escapeHtml(config.intro.kicker)}</p><h3>${escapeHtml(config.intro.title)}</h3><p>${escapeHtml(config.intro.text)}</p><p class="longread-note">${escapeHtml(config.intro.note)}</p>`;
    toc.innerHTML = `<strong>Содержание</strong><ol>
      <li><a href="#longread-elections">Округ и правила выборов</a></li>
      <li><a href="#longread-timeline">Хронология кампании</a></li>
      <li><a href="#longread-candidates">Кандидаты</a></li>
      ${candidateOrder.filter((candidate) => state.selectedCandidates.has(candidate.id)).map((candidate) => `<li><a href="#longread-candidate-${escapeHtml(candidate.id)}">${escapeHtml(candidate.short)}</a></li>`).join("")}
      <li><a href="#compare">Сравнение по вопросам</a></li>
      <li><a href="#ledger">Все источники</a></li>
    </ol>`;

    const general = config.general_chapters.map((chapter, index) => {
      const rows = state.claims.filter((row) => row.kandidat === "все" && chapter.themes.includes(row.tema));
      return `<section id="longread-${escapeHtml(chapter.id)}" class="longread-chapter">
        <div class="longread-chapter-heading"><p class="eyebrow">Глава ${index + 1}</p><h3>${escapeHtml(chapter.title)}</h3><p>${escapeHtml(chapter.lead)}</p></div>
        <div class="longread-claims">${rows.length ? rows.map(renderLongreadClaim).join("") : `<p class="longread-empty">В текущем списке отдельной записи нет.</p>`}</div>
      </section>`;
    }).join("");

    const selectedCandidateOrder = candidateOrder.filter((candidate) => state.selectedCandidates.has(candidate.id));
    const candidateChapters = `<section id="longread-candidates" class="longread-candidates"><div class="longread-chapter-heading"><p class="eyebrow">Глава 3</p><h3>Кандидаты</h3><p>У каждого профиля один и тот же порядок. Сначала опыт, затем кампании, работа с жителями, бизнес и публичные действия. Партийные материалы помечены отдельно.</p></div>${selectedCandidateOrder.map((orderItem) => {
      const candidate = state.candidateById.get(orderItem.id);
      if (!candidate) return "";
      const rows = state.claims.filter((row) => candidateIdFromName(row.kandidat) === candidate.id);
      const groups = config.candidate_groups.map((group) => renderLongreadClaimGroup(group.title, group.lead, rows.filter((row) => group.themes.includes(row.tema)))).join("");
      const mappedThemes = new Set(config.candidate_groups.flatMap((group) => group.themes));
      const otherRows = rows.filter((row) => !mappedThemes.has(row.tema));
      const other = renderLongreadClaimGroup(config.fallback.title, config.fallback.lead, otherRows);
      return `<article id="longread-candidate-${escapeHtml(candidate.id)}" class="longread-candidate">
        <header class="longread-candidate-heading"><p class="eyebrow">${escapeHtml(candidate.party || "Кандидат")}</p><h3>${escapeHtml(candidate.short)}</h3><p>${escapeHtml(shortRole(candidate) || "Кандидат по округу №3")}</p></header>
        <p class="longread-candidate-note">В этом профиле показано ${rows.length} записей. Это объём найденных материалов, а не оценка кандидата.</p>
        ${groups || `<p class="longread-empty">По кандидату пока нет отдельных записей.</p>`}
        ${other}
        ${renderSvoAudit(candidate)}
        ${(candidate.matrix_gaps || []).length ? `<section class="longread-gaps"><h4>Что ещё не удалось проверить</h4>${renderItems(candidate.matrix_gaps)}</section>` : ""}
        <p class="longread-back"><a href="#longread-candidates">↑ К списку кандидатов</a></p>
      </article>`;
    }).join("")}</section>`;

    content.innerHTML = `${general}${renderLongreadTimeline()}${candidateChapters}`;
  }

  function renderCandidateCard(candidate) {
    const allRows = state.claims.filter((row) => candidateIdFromName(row.kandidat) === candidate.id);
    const mappedIssues = state.issues.filter((issue) => issueClaims(issue.issue_id).some((row) => candidateIdFromName(row.kandidat) === candidate.id)).length;
    const personalRows = allRows
      .filter((row) => ["personal", "collective"].includes(classifyAttribution(row)))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)))
      .slice(0, 3);
    const positions = candidate.current_positions || [];
    const previousPositions = candidate.previous_positions || [];
    const roleItems = positions.filter((item) => !isPartyContext(item));
    const partyItems = positions.filter(isPartyContext);
    const previousRoleItems = previousPositions.filter((item) => !isPartyContext(item));
    const previousPartyItems = previousPositions.filter(isPartyContext);
    const gaps = candidate.matrix_gaps || [];

    return `<article class="candidate-card">
      <span class="eyebrow">${escapeHtml(candidate.party || "Кандидат")}</span>
      <h3>${escapeHtml(candidate.short)}</h3>
      <span class="party">${escapeHtml(candidate.party || "")}</span>
      <p class="candidate-role">${escapeHtml(shortRole(candidate) || "Кандидат по округу №3")}</p>
      <p class="coverage-note"><strong>${mappedIssues} из ${state.issues.length}</strong> тем имеют подтверждённые записи. Это не оценка кандидата.</p>
      <details>
        <summary>Показать больше о кандидате</summary>
        <div class="profile-sections">
          <section class="profile-subsection"><h4>Чем занимается</h4>${renderItems(roleItems, "Отдельная текущая роль не указана.")}</section>
          <section class="profile-subsection"><h4>Связь с партией</h4>${renderItems(partyItems, "Отдельная партийная роль не указана.")}</section>
          <section class="profile-subsection"><h4>Прошлый опыт</h4>${renderItems([...previousRoleItems, ...previousPartyItems], "Прошлый опыт в профиле не указан.")}</section>
          <section class="profile-subsection"><h4>Бизнес</h4>${renderItems(candidate.business, "Отдельные бизнес-сведения не указаны.")}</section>
          <section class="profile-subsection"><h4>Публичные страницы</h4>${renderSocial(candidate)}</section>
          <section class="profile-subsection"><h4>Слова и действия в списке</h4>${personalRows.length ? personalRows.map((row) => `<p><strong>${escapeHtml(row.tema)}:</strong> ${escapeHtml(row.utverzhdenie)} ${renderSource(row)}</p>`).join("") : `<p class="profile-empty">Отдельной личной записи пока нет.</p>`}</section>
          ${renderCandidateRecords(allRows)}
          ${renderSvoAudit(candidate)}
          ${gaps.length ? `<section class="profile-subsection"><h4>Что ещё не удалось проверить</h4>${renderItems(gaps)}</section>` : ""}
          <section class="profile-subsection"><h4>Источники</h4>${renderProfileLinks(candidate.key_sources, candidate)}</section>
          <section class="profile-subsection"><h4>Полный файл данных</h4><p><a href="data/candidates.json" target="_blank" rel="noopener">Открыть полный профиль</a></p></section>
        </div>
      </details>
    </article>`;
  }

  function renderCandidates() {
    $("#candidate-grid").innerHTML = candidateOrder
      .filter((orderItem) => state.selectedCandidates.has(orderItem.id))
      .map((orderItem) => state.candidateById.get(orderItem.id))
      .filter(Boolean)
      .map(renderCandidateCard)
      .join("");
  }

  function bindControls() {
    $("#topic-filter").addEventListener("change", (event) => {
      state.topic = event.target.value;
      renderComparison();
    });
    $("#evidence-filter").addEventListener("change", (event) => {
      state.evidence = event.target.value;
      renderComparison();
    });
    $("#search").addEventListener("input", (event) => {
      state.search = event.target.value;
      renderComparison();
    });
    $("#candidate-filter").addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[data-candidate]");
      if (!checkbox) return;
      const id = checkbox.dataset.candidate;
      if (!checkbox.checked && state.selectedCandidates.size === 1) {
        checkbox.checked = true;
        return;
      }
      if (checkbox.checked) state.selectedCandidates.add(id);
      else state.selectedCandidates.delete(id);
      rerenderFilteredViews();
    });
    document.querySelector("[data-filter-action=\"all\"]")?.addEventListener("click", () => {
      state.selectedCandidates = new Set(candidateOrder.map((candidate) => candidate.id));
      rerenderFilteredViews();
    });
    $("#disclosure-toggle").addEventListener("click", () => {
      setAllIssuesOpen(!state.allIssuesOpen);
    });
  }

  async function loadData() {
    const base = document.baseURI;
    const [matrixResponse, candidatesResponse, issuesResponse, longreadResponse] = await Promise.all([
      fetch(new URL("data/matriks.csv", base)),
      fetch(new URL("data/candidates.json", base)),
      fetch(new URL("data/issue_taxonomy.csv", base)),
      fetch(new URL("data/longread_sections.json", base))
    ]);
    if (!matrixResponse.ok || !candidatesResponse.ok || !issuesResponse.ok || !longreadResponse.ok) throw new Error("Не удалось загрузить один из файлов данных.");
    const [matrixText, candidateData, issueText, longreadData] = await Promise.all([
      matrixResponse.text(),
      candidatesResponse.json(),
      issuesResponse.text(),
      longreadResponse.json()
    ]);
    return { claims: parseCsv(matrixText), candidates: parseCandidates(candidateData), issues: parseCsv(issueText), longread: longreadData };
  }

  function showError(error) {
    $("#comparison-list").innerHTML = `<div class="error-card"><strong>Не удалось загрузить данные.</strong><br>Откройте сайт через HTTP или HTTPS, а не как файл на компьютере. Если ошибка повторится, проверьте папку <code>data/</code>.<br><small>${escapeHtml(error.message)}</small></div>`;
    $("#compare-status").textContent = "Ошибка загрузки";
  }

  async function init() {
    try {
      const data = await loadData();
      state.candidates = data.candidates;
      state.candidateById = new Map(data.candidates.map((candidate) => [candidate.id, candidate]));
      state.claims = data.claims;
      state.claimsById = new Map(data.claims.map((claim) => [claim.id, claim]));
      state.issues = data.issues;
      state.longread = data.longread;

      $("#stat-candidates").textContent = data.candidates.length;
      $("#stat-topics").textContent = data.issues.length;
      $("#stat-raw-topics").textContent = new Set(data.claims.map((claim) => claim.tema).filter(Boolean)).size;
      $("#stat-evidence").textContent = data.claims.length;
      $("#topic-filter").insertAdjacentHTML("beforeend", data.issues.map((issue) => `<option value="${escapeHtml(issue.issue_id)}">${escapeHtml(issue.category)}</option>`).join(""));
      renderTopCandidateFilter();
      renderLongread();
      renderComparison();
      renderCandidates();
      renderLedger();
      setAllIssuesOpen(state.allIssuesOpen);
      bindControls();
    } catch (error) {
      showError(error);
      console.error(error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
