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
});
