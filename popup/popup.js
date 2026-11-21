/**
 * AX-Privacy Popup Controller (Manifest V3 - v2.1.0)
 * Modern, responsive control panel logic.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const securityBadge = document.getElementById('securityBadge');
  const securityStatusText = document.getElementById('securityStatusText');
  const siteProtocol = document.getElementById('siteProtocol');
  const siteDomain = document.getElementById('siteDomain');
  const siteToggleBtn = document.getElementById('siteToggleBtn');
  const siteBtnIcon = document.getElementById('siteBtnIcon');
  const siteBtnText = document.getElementById('siteBtnText');
  const statRulesCount = document.getElementById('statRulesCount');
  const statThreatShield = document.getElementById('statThreatShield');

  const toggleAdBlock = document.getElementById('toggleAdBlock');
  const toggleUrlClean = document.getElementById('toggleUrlClean');
  const toggleCosmetic = document.getElementById('toggleCosmetic');
  const toggleThreat = document.getElementById('toggleThreat');
  const toggleTwitch = document.getElementById('toggleTwitch');
  const toggleYouTube = document.getElementById('toggleYouTube');
  const togglePopupShield = document.getElementById('togglePopupShield');
  const twitchProxyInput = document.getElementById('twitchProxyInput');
  const btnSaveProxy = document.getElementById('btnSaveProxy');
  const proxyFeedback = document.getElementById('proxyFeedback');

  // Custom Filter Lists Elements
  const customFiltersToggle = document.getElementById('customFiltersToggle');
  const customFiltersArrow = document.getElementById('customFiltersArrow');
  const customFiltersContent = document.getElementById('customFiltersContent');
  const customFilterCount = document.getElementById('customFilterCount');
  const btnUpdateAllFilters = document.getElementById('btnUpdateAllFilters');
  const customFilterUrlInput = document.getElementById('customFilterUrlInput');
  const customFilterNameInput = document.getElementById('customFilterNameInput');
  const btnAddCustomFilter = document.getElementById('btnAddCustomFilter');
  const customFilterError = document.getElementById('customFilterError');
  const customFilterEmptyState = document.getElementById('customFilterEmptyState');
  const customFilterItems = document.getElementById('customFilterItems');
  const filterRulesSummary = document.getElementById('filterRulesSummary');
  const filterUpdateStatusText = document.getElementById('filterUpdateStatusText');

  let currentTab = null;
  let currentHostname = '';
  let isSystemPage = false;
  let isWhitelisted = false;

  function updateThreatBadge(threatLevel) {
    securityBadge.className = 'status-badge';
    if (threatLevel === 'danger') {
      securityBadge.classList.add('status-danger');
      securityStatusText.textContent = 'Tehlikeli';
    } else if (threatLevel === 'warning') {
      securityBadge.classList.add('status-warning');
      securityStatusText.textContent = 'Dikkat';
    } else {
      securityBadge.classList.add('status-safe');
      securityStatusText.textContent = 'Güvenli';
    }
  }

  function renderSiteButton(paused) {
    if (isSystemPage) {
      siteToggleBtn.disabled = true;
      siteToggleBtn.className = 'site-btn';
      siteBtnIcon.textContent = '🔒';
      siteBtnText.textContent = 'Sistem Sayfası';
      return;
    }

    siteToggleBtn.disabled = false;
    if (paused) {
      siteToggleBtn.className = 'site-btn btn-paused';
      siteBtnIcon.textContent = '⏸';
      siteBtnText.textContent = 'Koruma Duraklatıldı';
    } else {
      siteToggleBtn.className = 'site-btn btn-active';
      siteBtnIcon.textContent = '✓';
      siteBtnText.textContent = 'Koruma Açık';
    }
  }

  function setCustomFilterError(msg) {
    if (!customFilterError) return;
    if (msg) {
      customFilterError.textContent = msg;
      customFilterError.style.display = 'block';
    } else {
      customFilterError.textContent = '';
      customFilterError.style.display = 'none';
    }
  }

  function renderCustomFilterLists(lists, status) {
    const listArray = Array.isArray(lists) ? lists : [];
    if (customFilterCount) {
      customFilterCount.textContent = String(listArray.length);
    }

    if (filterRulesSummary && status) {
      const dynamicCount = status.totalRules || 0;
      filterRulesSummary.textContent = `Statik: 25.000+ • Canlı: ${dynamicCount.toLocaleString('tr-TR')} kural`;
    }

    if (filterUpdateStatusText && status) {
      if (status.status === 'ok') {
        filterUpdateStatusText.textContent = status.lastUpdated
          ? new Date(status.lastUpdated).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
          : 'Güncel';
        filterUpdateStatusText.className = 'filter-status-pill pill-ok';
      } else if (status.status === 'error') {
        filterUpdateStatusText.textContent = 'Hata';
        filterUpdateStatusText.className = 'filter-status-pill pill-err';
      } else {
        filterUpdateStatusText.textContent = 'Bekliyor';
        filterUpdateStatusText.className = 'filter-status-pill';
      }
    }

    if (!customFilterItems) return;

    // Strict XSS Prevention: Safe DOM node creation and textContent only
    while (customFilterItems.firstChild) {
      customFilterItems.removeChild(customFilterItems.firstChild);
    }

    if (listArray.length === 0) {
      if (customFilterEmptyState) customFilterEmptyState.style.display = 'block';
      return;
    }
    if (customFilterEmptyState) customFilterEmptyState.style.display = 'none';

    listArray.forEach((list) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'custom-filter-item';
      itemEl.dataset.id = list.id;

      // Left info block (Name & URL with hover tooltip)
      const infoEl = document.createElement('div');
      infoEl.className = 'custom-filter-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'custom-filter-name';
      nameEl.textContent = list.name || 'Özel Liste';

      const urlEl = document.createElement('div');
      urlEl.className = 'custom-filter-url';
      urlEl.textContent = list.url || '';
      urlEl.setAttribute('title', list.url || '');

      infoEl.appendChild(nameEl);
      infoEl.appendChild(urlEl);

      // Right actions block
      const actionsEl = document.createElement('div');
      actionsEl.className = 'custom-filter-actions';

      // Status Badge (+X kural or error)
      const statusEl = document.createElement('span');
      statusEl.className = 'custom-filter-status';
      if (list.lastStatus === 'ok') {
        statusEl.classList.add('status-ok');
        statusEl.textContent = `+${list.ruleCount || 0} kural`;
      } else if (list.lastStatus === 'error') {
        statusEl.classList.add('status-err');
        statusEl.textContent = list.lastError ? `Hata: ${list.lastError}` : 'Hata';
        statusEl.setAttribute('title', list.lastError || 'Bilinmeyen hata');
      } else {
        statusEl.classList.add('status-idle');
        statusEl.textContent = 'Bekliyor';
      }
      actionsEl.appendChild(statusEl);

      // Toggle Switch
      const switchLabel = document.createElement('label');
      switchLabel.className = 'switch switch-sm';

      const switchInput = document.createElement('input');
      switchInput.type = 'checkbox';
      switchInput.checked = !!list.enabled;
      switchInput.addEventListener('change', async () => {
        try {
          switchInput.disabled = true;
          const res = await chrome.runtime.sendMessage({
            type: 'TOGGLE_CUSTOM_FILTER_LIST',
            id: list.id,
            enabled: switchInput.checked
          });
          if (res && res.success) {
            renderCustomFilterLists(res.customFilterLists, res.filterUpdateStatus);
          }
        } catch (err) {
          console.error('Error toggling custom filter list:', err);
        } finally {
          switchInput.disabled = false;
        }
      });

      const sliderSpan = document.createElement('span');
      sliderSpan.className = 'slider';

      switchLabel.appendChild(switchInput);
      switchLabel.appendChild(sliderSpan);
      actionsEl.appendChild(switchLabel);

      // Delete Button
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-delete-filter';
      deleteBtn.textContent = '✕';
      deleteBtn.setAttribute('title', 'Bu listeyi sil');
      deleteBtn.addEventListener('click', async () => {
        try {
          deleteBtn.disabled = true;
          const res = await chrome.runtime.sendMessage({
            type: 'REMOVE_CUSTOM_FILTER_LIST',
            id: list.id
          });
          if (res && res.success) {
            renderCustomFilterLists(res.customFilterLists, res.filterUpdateStatus);
          }
        } catch (err) {
          console.error('Error removing custom filter list:', err);
        }
      });
      actionsEl.appendChild(deleteBtn);

      itemEl.appendChild(infoEl);
      itemEl.appendChild(actionsEl);

      customFilterItems.appendChild(itemEl);
    });
  }

  // Get active tab info
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      currentTab = tabs[0];
      const urlString = currentTab.url || '';

      try {
        const url = new URL(urlString);
        const protocol = url.protocol.toLowerCase();

        if (protocol === 'http:' || protocol === 'https:') {
          currentHostname = url.hostname.toLowerCase();
          siteDomain.textContent = currentHostname;
          siteProtocol.textContent = protocol.replace(':', '').toUpperCase();
          if (protocol === 'http:') {
            siteProtocol.classList.add('insecure');
          }
        } else {
          isSystemPage = true;
          siteDomain.textContent = 'Tarayıcı Sistem Sayfası';
          siteProtocol.textContent = 'SİSTEM';
          renderSiteButton(false);
        }
      } catch {
        isSystemPage = true;
        siteDomain.textContent = 'Sistem Sayfası';
        siteProtocol.textContent = 'SİSTEM';
        renderSiteButton(false);
      }
    }
  } catch (err) {
    console.warn('Could not query active tab:', err);
  }

  // Fetch full state from background
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_STATE',
      tabId: currentTab?.id
    });

    if (res && res.success) {
      const { settings, threat } = res;

      // Update Module Toggles
      toggleAdBlock.checked = settings.adBlock !== undefined ? settings.adBlock : true;
      toggleUrlClean.checked = settings.urlClean !== undefined ? settings.urlClean : true;
      toggleCosmetic.checked = settings.cosmeticFilter !== undefined ? settings.cosmeticFilter : true;
      toggleThreat.checked = settings.threatShield !== undefined ? settings.threatShield : true;
      toggleTwitch.checked = settings.twitchShield !== undefined ? settings.twitchShield : true;
      toggleYouTube.checked = settings.youtubeShield !== undefined ? settings.youtubeShield : true;
      if (togglePopupShield) {
        togglePopupShield.checked = settings.popupShield !== undefined ? settings.popupShield : true;
      }
      if (twitchProxyInput && settings.twitchProxyUrl !== undefined) {
        twitchProxyInput.value = settings.twitchProxyUrl;
      }

      // Update Stat Rules Count
      if (settings.adBlock) {
        statRulesCount.textContent = '25.000+';
        statRulesCount.className = 'stat-number stat-rules';
      } else {
        statRulesCount.textContent = 'Pasif';
        statRulesCount.className = 'stat-number stat-disabled';
      }

      // Threat Shield Stat
      if (settings.threatShield) {
        statThreatShield.textContent = 'Aktif';
        statThreatShield.className = 'stat-number stat-active';
      } else {
        statThreatShield.textContent = 'Kapalı';
        statThreatShield.className = 'stat-number stat-disabled';
      }

      // Whitelist check
      const whitelist = settings.whitelist || [];
      isWhitelisted = whitelist.includes(currentHostname);
      renderSiteButton(isWhitelisted);

      // Threat status badge
      if (!settings.threatShield) {
        updateThreatBadge('safe');
      } else {
        updateThreatBadge(threat?.level || 'safe');
      }

      // Render Custom Filter Lists
      renderCustomFilterLists(
        res.customFilterLists || settings.customFilterLists || [],
        res.filterUpdateStatus || settings.filterUpdateStatus || null
      );
    }
  } catch (err) {
    console.error('Failed to get background state:', err);
  }

  // Site toggle click handler
  siteToggleBtn.addEventListener('click', async () => {
    if (isSystemPage || !currentHostname) return;

    try {
      siteToggleBtn.disabled = true;
      const res = await chrome.runtime.sendMessage({
        type: 'TOGGLE_WHITELIST',
        domain: currentHostname
      });

      if (res && res.success) {
        isWhitelisted = res.isWhitelisted;
        renderSiteButton(isWhitelisted);

        // Reload the tab so rules/cosmetics apply immediately
        if (currentTab?.id) {
          chrome.tabs.reload(currentTab.id);
        }
      }
    } catch (err) {
      console.error('Error toggling whitelist:', err);
    } finally {
      siteToggleBtn.disabled = false;
    }
  });

  // Helper for setting updates
  async function updateSetting(key, value) {
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        key,
        value
      });
    } catch (err) {
      console.error(`Error updating setting ${key}:`, err);
    }
  }

  // Module toggle event listeners
  toggleAdBlock.addEventListener('change', () => {
    const isEnabled = toggleAdBlock.checked;
    updateSetting('adBlock', isEnabled);
    if (isEnabled) {
      statRulesCount.textContent = '25.000+';
      statRulesCount.className = 'stat-number stat-rules';
    } else {
      statRulesCount.textContent = 'Pasif';
      statRulesCount.className = 'stat-number stat-disabled';
    }
  });

  toggleUrlClean.addEventListener('change', () => {
    updateSetting('urlClean', toggleUrlClean.checked);
  });

  toggleCosmetic.addEventListener('change', () => {
    updateSetting('cosmeticFilter', toggleCosmetic.checked);
  });

  toggleThreat.addEventListener('change', async () => {
    const isEnabled = toggleThreat.checked;
    await updateSetting('threatShield', isEnabled);
    if (isEnabled) {
      statThreatShield.textContent = 'Aktif';
      statThreatShield.className = 'stat-number stat-active';
      const threatRes = await chrome.runtime.sendMessage({
        type: 'GET_THREAT_STATUS',
        tabId: currentTab?.id
      });
      updateThreatBadge(threatRes?.threat?.level || 'safe');
    } else {
      statThreatShield.textContent = 'Kapalı';
      statThreatShield.className = 'stat-number stat-disabled';
      updateThreatBadge('safe');
    }
  });

  toggleTwitch.addEventListener('change', async () => {
    const isEnabled = toggleTwitch.checked;
    await updateSetting('twitchShield', isEnabled);
    if (currentHostname && currentHostname.includes('twitch.tv') && currentTab?.id) {
      chrome.tabs.reload(currentTab.id);
    }
  });

  toggleYouTube.addEventListener('change', async () => {
    const isEnabled = toggleYouTube.checked;
    await updateSetting('youtubeShield', isEnabled);
    if (currentHostname && currentHostname.includes('youtube.com') && currentTab?.id) {
      chrome.tabs.reload(currentTab.id);
    }
  });

  if (togglePopupShield) {
    togglePopupShield.addEventListener('change', async () => {
      const isEnabled = togglePopupShield.checked;
      await updateSetting('popupShield', isEnabled);
      if (currentTab?.id) {
        chrome.tabs.reload(currentTab.id);
      }
    });
  }

  if (btnSaveProxy && twitchProxyInput) {
    btnSaveProxy.addEventListener('click', async () => {
      const val = twitchProxyInput.value.trim();
      btnSaveProxy.disabled = true;
      await updateSetting('twitchProxyUrl', val);
      btnSaveProxy.disabled = false;
      if (proxyFeedback) {
        proxyFeedback.textContent = 'Kaydedildi ✓';
        proxyFeedback.classList.add('visible');
        setTimeout(() => {
          proxyFeedback.classList.remove('visible');
        }, 2000);
      }
      if (currentHostname && currentHostname.includes('twitch.tv') && currentTab?.id) {
        chrome.tabs.reload(currentTab.id);
      }
    });
  }

  // Accordion Toggle for Custom Filters
  if (customFiltersToggle && customFiltersContent && customFiltersArrow) {
    let isOpen = false;
    customFiltersToggle.addEventListener('click', (e) => {
      // Ignore click if user clicked refresh button
      if (e.target && e.target.closest('#btnUpdateAllFilters')) return;
      isOpen = !isOpen;
      if (isOpen) {
        customFiltersContent.classList.remove('collapsed');
        customFiltersArrow.classList.add('expanded');
        customFiltersToggle.setAttribute('aria-expanded', 'true');
      } else {
        customFiltersContent.classList.add('collapsed');
        customFiltersArrow.classList.remove('expanded');
        customFiltersToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Add Custom Filter List Handler
  if (btnAddCustomFilter && customFilterUrlInput) {
    const handleAdd = async () => {
      setCustomFilterError(null);
      const url = customFilterUrlInput.value.trim();
      const name = customFilterNameInput?.value.trim() || '';

      if (!url) {
        setCustomFilterError('Lütfen bir filtre listesi URL\'si giriniz.');
        customFilterUrlInput.focus();
        return;
      }

      try {
        btnAddCustomFilter.disabled = true;
        btnAddCustomFilter.textContent = '...';

        const res = await chrome.runtime.sendMessage({
          type: 'ADD_CUSTOM_FILTER_LIST',
          url,
          name
        });

        if (res && res.success) {
          customFilterUrlInput.value = '';
          if (customFilterNameInput) customFilterNameInput.value = '';
          renderCustomFilterLists(res.customFilterLists, res.filterUpdateStatus);
        } else {
          setCustomFilterError(res?.error || 'Filtre listesi eklenemedi.');
        }
      } catch (err) {
        setCustomFilterError(err?.message || 'Bağlantı hatası.');
      } finally {
        btnAddCustomFilter.disabled = false;
        btnAddCustomFilter.textContent = 'Ekle';
      }
    };

    btnAddCustomFilter.addEventListener('click', handleAdd);
    customFilterUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
    if (customFilterNameInput) {
      customFilterNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdd();
      });
    }
  }

  // Manual Trigger to Refresh All Filter Lists
  if (btnUpdateAllFilters) {
    btnUpdateAllFilters.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        btnUpdateAllFilters.classList.add('spinning');
        btnUpdateAllFilters.disabled = true;
        const res = await chrome.runtime.sendMessage({
          type: 'UPDATE_FILTER_LISTS'
        });
        if (res && res.success) {
          renderCustomFilterLists(res.customFilterLists, res.filterUpdateStatus);
        }
      } catch (err) {
        console.error('Error updating filter lists:', err);
      } finally {
        btnUpdateAllFilters.classList.remove('spinning');
        btnUpdateAllFilters.disabled = false;
      }
    });
  }
});
