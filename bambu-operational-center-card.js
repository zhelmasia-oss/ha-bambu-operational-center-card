/**
 * ============================================================================
 * BAMBU OPERATIONAL CENTER CARD
 * Version: 7.1 — "2nd-Gen UI" visual reskin (light, card-based touchscreen
 * look mirroring the Bambu P2S / X2D display and Bambu Handy; tuned for a
 * wall/stand-mounted tablet at HD+ resolution as a dedicated print-control
 * home screen). All functionality, entities, and logic from v7.0 unchanged
 * — this pass only touches CSS/inline styling.
 * Designed for Bambu Lab P1S / P2S / X1C / X2D / A1 Series on Home Assistant
 * ============================================================================
 */

class BambuOperationalCenterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Internal UI State
    this._activeTab = 'home';
    this._jogStep = 10;
    this._selectedTrayIndex = null;
    this._selectedReprintFile = null;
    this._skippedObjectIds = new Set();

    // Power monitoring: tracks whether a print was running on the previous
    // update tick, and the lifetime-energy-counter reading captured the
    // moment the current print started, so "energy this print" can be
    // computed as (current total energy - baseline) rather than needing the
    // printer/plug itself to expose a per-job counter.
    this._wasPrinting = false;
    this._printEnergyBaseline = null;

    // Tap-on-image "Skip Objects" modal state (mirrors the official
    // ha-bambulab print-status card: Map<objectId, {name, skipped, to_skip}>)
    this._skipObjectsMap = new Map();
    this._hoveredSkipObjectId = 0;
    this._skipPickCtx = null;      // offscreen ctx holding the raw color-id image
    this._skipVisibleCtx = null;   // visible ctx we paint the green/red/outline overlay onto
    this._skipPickImage = null;

    // Pagination State
    this._pageSize = 10;
    this._currentPage = 1;
    this._historySortDir = 'desc';

    // Live telemetry history (for sparklines)
    this._nozzleHistory = [];
    this._bedHistory = [];
    this._historyMax = 60;

    // Track the last media entity ids we bound, so we only touch the
    // <img>/<ha-camera-stream> DOM nodes when something actually changed
    this._lastCameraEntity = null;
    this._lastCoverToken = null;

    // Auto-fit-to-panel state: we measure the card's natural size against
    // whatever space the dashboard actually gives us and scale the whole
    // shell down (never up beyond ~5%) so it never has to scroll.
    this._fitRaf = null;
    this._resizeObserver = null;

    // ------------------------------------------------------------------
    // Filament catalog — matches the current Bambu Lab / Bambu Handy
    // lineup, grouped by family. `ams` = false means external-spool-only
    // ------------------------------------------------------------------
    // `idx` = Bambu's own filament profile ID (`tray_info_idx`, as used by
    // BambuStudio's system filament profiles / the printer's RFID database).
    // `type` = the short material code the printer firmware expects in
    // `tray_type`. Both are required to actually push a filament choice to
    // the printer via `bambu_lab.set_filament` — without them the AMS/tray
    // just gets a cosmetic local label the printer never sees (the original
    // bug). Entries with no official Bambu SKU fall back to the matching
    // Generic profile ID for that material family rather than a fabricated
    // one.
    this._bambuFilamentCatalog = [
      { group: 'PLA', items: [
        { name: 'PLA Basic',        color: '#00AE42', tempMin: 190, tempMax: 230, ams: true,  idx: 'GFA00', type: 'PLA' },
        { name: 'PLA Matte',        color: '#0A8FBF', tempMin: 190, tempMax: 230, ams: true,  idx: 'GFA01', type: 'PLA' },
        { name: 'PLA Lite',         color: '#2FBF71', tempMin: 190, tempMax: 220, ams: true,  idx: 'GFL99', type: 'PLA' },
        { name: 'PLA Silk+',        color: '#FFD54A', tempMin: 195, tempMax: 230, ams: true,  idx: 'GFA05', type: 'PLA' },
        { name: 'PLA Metal',        color: '#8A8D91', tempMin: 200, tempMax: 230, ams: true,  idx: 'GFA02', type: 'PLA' },
        { name: 'PLA Marble',       color: '#E8E6E1', tempMin: 195, tempMax: 230, ams: true,  idx: 'GFA07', type: 'PLA' },
        { name: 'PLA Galaxy',       color: '#1B1F3B', tempMin: 195, tempMax: 230, ams: true,  idx: 'GFA15', type: 'PLA' },
        { name: 'PLA Sparkle',      color: '#2A2A2E', tempMin: 195, tempMax: 230, ams: true,  idx: 'GFA08', type: 'PLA' },
        { name: 'PLA Wood',         color: '#B08050', tempMin: 195, tempMax: 220, ams: true,  idx: 'GFL99', type: 'PLA' },
        { name: 'PLA Glow',         color: '#C6FF6B', tempMin: 190, tempMax: 230, ams: true,  idx: 'GFA12', type: 'PLA' },
        { name: 'PLA Aero',         color: '#F2F2F2', tempMin: 210, tempMax: 235, ams: false, idx: 'GFA11', type: 'PLA' },
        { name: 'PLA-CF',           color: '#1C1C1C', tempMin: 200, tempMax: 240, ams: true,  idx: 'GFA50', type: 'PLA' },
      ]},
      { group: 'PETG', items: [
        { name: 'PETG Basic',       color: '#FF6F00', tempMin: 230, tempMax: 260, ams: true,  idx: 'GFG00', type: 'PETG' },
        { name: 'PETG HF',          color: '#E8590C', tempMin: 230, tempMax: 260, ams: true,  idx: 'GFG02', type: 'PETG' },
        { name: 'PETG Translucent', color: '#CFE8F5', tempMin: 230, tempMax: 260, ams: true,  idx: 'GFG01', type: 'PETG' },
        { name: 'PETG-CF',          color: '#2B2B2B', tempMin: 240, tempMax: 270, ams: true,  idx: 'GFG50', type: 'PETG' },
      ]},
      { group: 'ABS / ASA / PC', items: [
        { name: 'ABS',              color: '#E30613', tempMin: 240, tempMax: 270, ams: true,  idx: 'GFB00', type: 'ABS' },
        { name: 'ABS-GF',           color: '#7A7A7A', tempMin: 250, tempMax: 280, ams: true,  idx: 'GFB50', type: 'ABS' },
        { name: 'ASA',              color: '#004A99', tempMin: 240, tempMax: 270, ams: true,  idx: 'GFB01', type: 'ASA' },
        { name: 'ASA-Aero',         color: '#5B7FB5', tempMin: 240, tempMax: 270, ams: false, idx: 'GFB02', type: 'ASA' },
        { name: 'PC',               color: '#FFFFFF', tempMin: 260, tempMax: 290, ams: true,  idx: 'GFC00', type: 'PC' },
        { name: 'PC FR',            color: '#EFEFEF', tempMin: 260, tempMax: 290, ams: true,  idx: 'GFC00', type: 'PC' },
      ]},
      { group: 'Engineering', items: [
        { name: 'PA6-CF',           color: '#181818', tempMin: 260, tempMax: 300, ams: false, idx: 'GFN05', type: 'PA' },
        { name: 'PA6-GF',           color: '#4B4B4B', tempMin: 260, tempMax: 300, ams: true,  idx: 'GFN08', type: 'PA' },
        { name: 'PAHT-CF',          color: '#101010', tempMin: 260, tempMax: 300, ams: false, idx: 'GFN04', type: 'PA' },
        { name: 'PPA-CF',           color: '#20242C', tempMin: 270, tempMax: 310, ams: false, idx: 'GFN06', type: 'PA' },
        { name: 'PPA-GF',           color: '#565B66', tempMin: 270, tempMax: 310, ams: false, idx: 'GFN96', type: 'PA' },
        { name: 'PPS-CF',           color: '#12161C', tempMin: 280, tempMax: 320, ams: false, idx: 'GFT02', type: 'PPS' },
      ]},
      { group: 'TPU / Flexible', items: [
        { name: 'TPU 95A',          color: '#9B51E0', tempMin: 200, tempMax: 240, ams: false, idx: 'GFU01', type: 'TPU' },
        { name: 'TPU 95A HF',       color: '#7C3AED', tempMin: 200, tempMax: 240, ams: false, idx: 'GFU00', type: 'TPU' },
      ]},
      { group: 'Support', items: [
        { name: 'Support for PLA',  color: '#F0F0F0', tempMin: 190, tempMax: 230, ams: true,  idx: 'GFS02', type: 'PLA' },
        { name: 'Support for ABS/ASA (interface)', color: '#DADADA', tempMin: 240, tempMax: 270, ams: false, idx: 'GFS06', type: 'ABS' },
        { name: 'PVA',              color: '#EFE7D8', tempMin: 190, tempMax: 220, ams: false, idx: 'GFS04', type: 'PVA' },
      ]},
      { group: 'Generic / Third-party', items: [
        { name: 'Generic PLA',      color: '#0088FF', tempMin: 190, tempMax: 230, ams: true,  idx: 'GFL99', type: 'PLA' },
        { name: 'Generic PETG',     color: '#FF3300', tempMin: 230, tempMax: 260, ams: true,  idx: 'GFG99', type: 'PETG' },
        { name: 'Generic ABS',      color: '#CC0000', tempMin: 240, tempMax: 270, ams: true,  idx: 'GFB99', type: 'ABS' },
        { name: 'Generic ASA',      color: '#002288', tempMin: 240, tempMax: 270, ams: true,  idx: 'GFB98', type: 'ASA' },
        { name: 'Generic TPU',      color: '#8800CC', tempMin: 200, tempMax: 240, ams: false, idx: 'GFU99', type: 'TPU' },
        { name: 'Generic PC',       color: '#DDDDDD', tempMin: 260, tempMax: 290, ams: true,  idx: 'GFC99', type: 'PC' },
      ]},
    ];
    this._flatFilamentCatalog = this._bambuFilamentCatalog.flatMap(g => g.items);
    // Populated from `bambu_lab.get_filament_data` (includes custom/user
    // filaments the printer's RFID/AMS database knows about that aren't in
    // the static Bambu catalog above). Fetched automatically on load and
    // merged as its own group at the top of the AMS dropdown, so "source
    // for filament list = the dumped list" rather than the hardcoded one.
    this._printerFilamentGroup = null;

    // Diagnostic HMS Database
    this._hmsDatabase = {
      '0300_0100_0001_0001': 'AMS Slot 1 Loader Failure: Unable to feed filament to toolhead.',
      '0300_0200_0001_0001': 'AMS Slot 2 Loader Failure: Unable to feed filament to toolhead.',
      '0300_0300_0001_0001': 'AMS Slot 3 Loader Failure: Unable to feed filament to toolhead.',
      '0300_0400_0001_0001': 'AMS Slot 4 Loader Failure: Unable to feed filament to toolhead.',
      '0500_0100_0002_0002': 'Toolhead Cable Connection Warning: Inspect main umbilical connector.',
      '0300_0800_0001_0002': 'External Spool Feed Blockage: Filament clogged in rear PTFE tube.',
      '0100_0100_0001_0001': 'Heatbed Thermal Drift: Heating slope below safety profile threshold.',
      '0100_0200_0001_0001': 'Hotend Heating Abnormal: Sensor failure or heater cartridge fault.',
      '0300_0d00_0001_0001': 'AMS Filament Hub Stuck: Retraction or extrusion motor overload.'
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid Home Assistant Configuration.");

    this._config = {
      title: 'P1S OPERATIONAL CENTER',
      device_id: 'p1s_01p00c592600730',
      power_switch_entity: 'switch.gniazdo_setti_sp301_socket_1',
      task_name_entity: 'sensor.p1s_01p00c592600730_pobrany_plik_g_code',
      folder_sensor: 'sensor.cache',
      camera_entity: 'camera.p1s_01p00c592600730_kamera',
      camera_switch_entity: 'switch.p1s_01p00c592600730_wlacz_kamere',
      cover_image_entity: 'image.p1s_01p00c592600730_podglad_modelu',
      print_status_entity: 'sensor.p1s_01p00c592600730_status_druku',
      stage_entity: 'sensor.p1s_01p00c592600730_aktualny_stan',
      progress_entity: 'sensor.p1s_01p00c592600730_postep_drukowania',
      current_layer_entity: 'sensor.p1s_01p00c592600730_aktualna_warstwa',
      total_layers_entity: 'sensor.p1s_01p00c592600730_laczna_liczba_warstw',
      remaining_time_entity: 'sensor.p1s_01p00c592600730_pozostaly_czas',
      print_error_entity: 'binary_sensor.p1s_01p00c592600730_blad_drukowania',
      nozzle_temp_entity: 'sensor.p1s_01p00c592600730_temperatura_dyszy',
      nozzle_target_entity: 'number.p1s_docelowa_temperatura_dyszy',
      bed_temp_entity: 'sensor.p1s_01p00c592600730_temperatura_stolu',
      bed_target_entity: 'number.p1s_docelowa_temperatura_stolu',
      chamber_temp_entity: 'sensor.p1s_01p00c592600730_temperatura_komory',
      fan_part_entity: 'fan.p1s_01p00c592600730_wentylator_chlodzacy',
      fan_aux_entity: 'fan.p1s_01p00c592600730_wentylator_obudowy',
      fan_chamber_entity: 'fan.p1s_01p00c592600730_wentylator_pomocniczy',
      light_entity: 'light.p1s_01p00c592600730_oswietlenie_wnetrza',
      pause_entity: 'button.p1s_01p00c592600730_wstrzymaj_drukowanie',
      resume_entity: 'button.p1s_01p00c592600730_wznow_drukowanie',
      stop_entity: 'button.p1s_01p00c592600730_zatrzymaj_drukowanie',
      // Full state refresh button — leave blank if your bambu_lab integration
      // instance doesn't expose one; the on-screen icon becomes a no-op.
      full_refresh_entity: '',
      speed_profile_entity: 'select.p1s_01p00c592600730_predkosc_druku',
      ams_humidity_entity: 'sensor.p1s_01p00c592600730_ams_1_indeks_wilgotnosci',
      ams_temperature_entity: 'sensor.p1s_01p00c592600730_ams_1_temperatura',
      // Optional: an entity (select/sensor) whose state/attribute tells us
      // which AMS tray index (0-3) is currently loaded/active. If your
      // integration doesn't expose one, leave this blank — the card will
      // fall back to each tray's own `active` attribute (cast to boolean).
      active_tray_entity: '',
      ams_trays: [
        'sensor.p1s_01p00c592600730_ams_1_slot_1',
        'sensor.p1s_01p00c592600730_ams_1_slot_2',
        'sensor.p1s_01p00c592600730_ams_1_slot_3',
        'sensor.p1s_01p00c592600730_ams_1_slot_4'
      ],
      external_spool_entity: 'sensor.p1s_01p00c592600730_externalspool_zewnetrzna_szpula',
      // Power monitoring — read from the mains smart-plug's own sensors.
      // Most smart plugs (Sonoff/Tasmota/Setti-style) expose these as
      // sibling sensor entities to the switch itself, e.g.
      // sensor.gniazdo_setti_sp301_socket_1_power. Leave blank to hide
      // that stat. power_total_energy_entity should be a lifetime/
      // cumulative kWh counter (not one that resets daily) — that's what
      // "power consumed during current print" is subtracted from.
      power_current_entity: '',
      power_consumption_entity: '',
      power_total_energy_entity: '',
      wifi_entity: 'sensor.p1s_01p00c592600730_sygnal_wi_fi',
      hms_entity: 'binary_sensor.p1s_01p00c592600730_bledy_hms',
      hms_code_entity: 'sensor.p1s_01p00c592600730_kod_bledu_hms',
      ip_address_entity: 'sensor.p1s_01p00c592600730_adres_ip',
      usage_hours_entity: 'sensor.p1s_01p00c592600730_calkowity_czas_pracy',
      mqtt_mode_entity: 'sensor.p1s_01p00c592600730_tryb_polaczenia_mqtt',
      sd_card_entity: 'sensor.p1s_01p00c592600730_status_karty_sd',
      thumbnail_base_path: '/local/cache/',
      // Relative folder on the printer's own SD card where sliced 3MF
      // project files live (used to build `filepath` for print_project_file
      // and the `url` for the raw MQTT fallback). Matches Bambu Studio/Handy's
      // own on-printer cache convention.
      sdcard_cache_path: 'cache/',
      // Home Assistant has no built-in "delete a file" service, so deleting
      // the cached .3mf/.png/.gcode trio has to go through a shell_command
      // or script you define yourself. Format: "domain.service_name". Leave
      // blank to disable the delete button's actual file removal (it will
      // still explain what to set up). The service is called with
      // { [delete_cache_files_param]: <basename without extension> }.
      delete_cache_files_service: '',
      delete_cache_files_param: 'basename',
      // These three are OPTIONAL manual overrides — normally left blank.
      // The card auto-discovers the right entities from the entity registry
      // by device + translation_key (printable_objects / skipped_objects /
      // pick_image), same as the official ha-bambulab Print Control Card
      // does — that's why that card never asks you to configure them either.
      // Only set these if you have multiple Bambu printers and the
      // auto-discovery picks the wrong one.
      printable_objects_entity: '',
      skipped_objects_entity: '',
      pick_image_entity: '',
      ...config
    };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._renderBaseLayout();
      this._rendered = true;
      setTimeout(() => {
        this._updatePrintHistoryList();
        this._populateHandyFilaments();
        this._scheduleFit();
        this._fetchFilamentDataFromPrinter()
          .then(payload => this._applyFilamentDumpToCatalog(payload))
          .catch(() => { /* falls back to the static catalog silently */ });
      }, 150);
    }
    this._updateDynamicData();
  }

  // Watch the space Home Assistant actually gives this card (panel size,
  // sidebar toggling, window resize, orientation change, etc.) and re-fit
  // whenever it changes.
  connectedCallback() {
    if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._scheduleFit());
      this._resizeObserver.observe(this);
    }
    this._scheduleFit();
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._fitRaf) {
      cancelAnimationFrame(this._fitRaf);
      this._fitRaf = null;
    }
  }

  // Coalesce fit requests to one per animation frame so rapid-fire hass
  // updates / resizes don't thrash layout.
  _scheduleFit() {
    if (this._fitRaf || !this._rendered) return;
    this._fitRaf = requestAnimationFrame(() => {
      this._fitRaf = null;
      this._applyFit();
    });
  }

  // Measure the card's natural (unscaled) footprint against the space the
  // dashboard panel actually gives us, then scale the whole shell down (or
  // very slightly up) so the content fills the available area instead of
  // overflowing into a scrollbar.
  _applyFit() {
    const wrap = this.shadowRoot.getElementById('scale-wrap');
    const shell = this.shadowRoot.getElementById('app-shell');
    if (!wrap || !shell) return;

    // Reset first so we measure the shell's true natural size, not last
    // frame's scaled-down size.
    shell.style.transform = 'none';
    shell.style.width = '100%';

    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    const natW = shell.scrollWidth;
    const natH = shell.scrollHeight;
    if (!availW || !availH || !natW || !natH) return;

    let scale = Math.min(availW / natW, availH / natH);
    // Only shrink to fit — allow a touch of upscale on very spacious panels,
    // but never enough to make text blurry or the layout feel stretched.
    scale = Math.min(scale, 1.05);
    scale = Math.max(scale, 0.5);

    if (scale >= 0.995) {
      shell.style.transform = 'none';
      shell.style.width = '100%';
    } else {
      shell.style.transform = `scale(${scale})`;
      shell.style.width = `${(100 / scale).toFixed(3)}%`;
    }
  }

  // ==========================================================================
  // LAYOUT
  // ==========================================================================
  _renderBaseLayout() {
    this.shadowRoot.innerHTML = `
      <style>
        /* ============================================================
           BAMBU OPERATIONAL CENTER — Dark "2nd-Gen" touchscreen parity
           pass. Rebuilt to match the on-device dark UI used on the P2S /
           X2D / H2D touchscreen (and current Bambu Handy dark mode):
           near-black canvas, dark slate card surfaces, hairline borders
           a shade lighter than the surface, and the same accent-bar /
           compact-caption layout language as before — only the palette
           changed. Sized for a tablet at HD+.
           ============================================================ */
        :host {
          --bg-canvas: #0f1012;
          --bg-canvas-2: #08090a;
          --bg-surface: #1c1e21;
          --bg-surface-alt: #24262a;
          --bg-surface-sunken: #16171a;
          --bg-toolbar: #18191c;
          --ink: #eef0f2;
          --ink-soft: #c2c6cb;
          --ink-mute: #8b9096;
          --ink-faint: #5a5f65;
          --line: #303236;
          --line-strong: #3d4045;
          --brand: #00c853;
          --brand-dark: #00a844;
          --brand-tint: rgba(0,200,83,0.16);
          --brand-tint-strong: rgba(0,200,83,0.32);
          --info: #3ea6e0;
          --info-tint: rgba(62,166,224,0.16);
          --warn: #e0983b;
          --warn-tint: rgba(224,152,59,0.16);
          --danger: #ea5c53;
          --danger-tint: rgba(234,92,83,0.16);
          --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
          --shadow-md: 0 3px 10px rgba(0,0,0,0.35);
          --shadow-lg: 0 12px 32px rgba(0,0,0,0.5);
          --r-lg: 8px;
          --r-md: 6px;
          --r-sm: 4px;

          display: block;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          background: var(--bg-canvas);
          color: var(--ink);
          font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          box-sizing: border-box;
          -webkit-font-smoothing: antialiased;
        }
        * { scrollbar-width: thin; scrollbar-color: #45484d transparent; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #45484d; border-radius: 8px; }
        button:focus-visible, input:focus-visible, select:focus-visible {
          outline: 2px solid var(--brand); outline-offset: 1px;
        }

        .scale-wrap {
          width: 100%;
          height: 100%;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }

        .app-shell {
          display: flex;
          width: 100%;
          max-width: 2000px;
          flex-shrink: 0;
          padding: clamp(8px, 1vw, 14px);
          gap: clamp(8px, 1vw, 12px);
          box-sizing: border-box;
          align-items: flex-start;
          transform-origin: top center;
        }

        /* SIDEBAR — Studio's vertical tool rail: flat, square icons, a
           2px accent bar on the active item instead of a filled pill. */
        .sidebar {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 2px;
          background: var(--bg-toolbar);
          border: 1px solid var(--line);
          border-radius: var(--r-md);
          padding: 10px 0;
          box-shadow: var(--shadow-sm);
          flex: 0 0 72px;
          position: sticky;
          top: 10px;
        }
        .sidebar-brand {
          display: flex; align-items: center; justify-content: center;
          padding: 2px 0 12px 0; color: var(--brand);
          border-bottom: 1px solid var(--line); margin: 0 10px 10px;
        }
        .tab-btn {
          border: none;
          border-left: 3px solid transparent;
          background: transparent;
          color: var(--ink-mute);
          font-weight: 600;
          font-size: 10px;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-align: center;
          padding: 11px 3px;
        }
        .tab-btn svg { width: 20px; height: 20px; }
        .tab-btn:hover { color: var(--ink); background: var(--bg-surface-alt); }
        .tab-btn.active {
          background: var(--brand-tint);
          color: var(--brand-dark);
          border-left-color: var(--brand);
          font-weight: 700;
        }
        .sidebar-spacer { flex: 1; }
        .power-btn {
          background: transparent;
          border: none;
          border-top: 1px solid var(--line);
          color: var(--danger);
          width: 100%;
          height: 48px;
          margin-top: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .power-btn:hover { background: var(--danger-tint); }

        .main-column { display: flex; flex-direction: column; gap: clamp(8px, 1vw, 12px); flex: 1; min-width: 0; }

        /* HEADER — Studio's slim title bar */
        .header-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          background: var(--bg-toolbar);
          border: 1px solid var(--line);
          border-radius: var(--r-md);
          padding: 12px clamp(14px, 1.6vw, 22px);
          box-shadow: var(--shadow-sm);
        }

        .brand-box {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: clamp(13px, 1.3vw, 16px);
          font-weight: 700;
          letter-spacing: 0;
          color: var(--ink);
        }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 7px;
          background: var(--brand-tint);
          border: 1px solid var(--brand-tint-strong);
          color: var(--brand-dark);
          padding: 5px 14px 5px 10px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.2px;
          transition: all 0.3s ease;
        }
        .status-pill.idle {
          background: var(--bg-surface-alt);
          border-color: var(--line-strong);
          color: var(--ink-soft);
        }
        .status-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 0 0 currentColor;
          animation: dot-pulse 1.8s ease-out infinite;
        }
        .status-pill.idle .status-dot { animation: none; opacity: 0.6; }
        @keyframes dot-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(0,174,66,0.35); }
          70%  { box-shadow: 0 0 0 7px rgba(0,174,66,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,174,66,0); }
        }

        .viewport { position: relative; width: 100%; flex: 1; }

        .tab-pane { display: none !important; width: 100%; gap: 16px; box-sizing: border-box; }
        .tab-pane.active { display: flex !important; flex-direction: column; animation: pane-in 0.2s ease; }
        @keyframes pane-in {
          from { opacity: 0; } to { opacity: 1; }
        }

        .grid-responsive-2 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
          gap: 12px;
          width: 100%;
        }
        .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 118px), 1fr)); gap: 8px; width: 100%; }
        .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 148px), 1fr)); gap: 10px; width: 100%; }

        /* CARD — Studio's flat parameter-panel section: white, hairline
           border, tiny radius, no drop shadow at rest. */
        .card {
          background: var(--bg-surface);
          border: 1px solid var(--line);
          border-radius: var(--r-md);
          padding: clamp(12px, 1.2vw, 16px);
          display: flex;
          flex-direction: column;
          gap: 10px;
          box-sizing: border-box;
          width: 100%;
        }
        #job-progress-card {
          aspect-ratio: 5 / 3;
          justify-content: space-between;
          overflow: hidden;
        }
        .card-title {
          font-size: 11px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.3px; text-transform: uppercase;
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding-bottom: 8px; border-bottom: 1px solid var(--line);
        }

        .btn {
          background: var(--bg-surface);
          border: 1px solid var(--line-strong);
          color: var(--ink);
          padding: 9px 13px;
          border-radius: var(--r-sm);
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          transition: all 0.15s ease;
          user-select: none;
        }
        .btn:hover { background: var(--bg-surface-alt); border-color: var(--ink-faint); }
        .btn:active { background: var(--bg-surface-sunken); }
        .btn.primary { background: var(--brand); border-color: var(--brand); color: #ffffff; }
        .btn.primary:hover { background: var(--brand-dark); }
        .btn.danger { background: var(--danger-tint); border-color: rgba(216,67,58,0.35); color: var(--danger); }
        .btn.danger:hover { background: var(--danger); color: #ffffff; }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* PROGRESS RING */
        .progress-ring-wrap { display: flex; align-items: center; gap: 12px; }
        .progress-ring-wrap svg { transform: rotate(-90deg); }
        .progress-ring-bg { fill: none; stroke: var(--bg-surface-sunken); stroke-width: 5; }
        .progress-ring-fill { fill: none; stroke: var(--brand); stroke-width: 5; stroke-linecap: round; transition: stroke-dashoffset 0.6s ease; }
        .progress-ring-label { font-size: 15px; font-weight: 700; color: var(--ink); }

        /* THERMAL DIALS */
        .thermo-row { display: flex; align-items: center; gap: 10px; background: var(--bg-surface-alt); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 9px; position: relative; overflow: hidden; cursor: pointer; transition: all 0.15s ease; }
        .thermo-row:hover { border-color: var(--brand); }
        .thermo-row.heating::before {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(100deg, transparent 20%, rgba(216,67,58,0.08) 45%, transparent 70%);
          background-size: 220% 100%;
          animation: heat-sweep 2.2s linear infinite;
          pointer-events: none;
        }
        .thermo-row.bed-heating::before { background: linear-gradient(100deg, transparent 20%, rgba(200,121,15,0.09) 45%, transparent 70%); }
        @keyframes heat-sweep { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }
        .edit-hint { margin-left: auto; color: var(--ink-faint); flex-shrink: 0; }
        .edit-hint svg { width: 15px; height: 15px; }

        .thermo-dial {
          --pct: 0;
          --dial-color: #d8433a;
          width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; position: relative;
          background: conic-gradient(var(--dial-color) calc(var(--pct) * 1%), var(--bg-surface-sunken) 0);
          display: flex; align-items: center; justify-content: center;
          transition: background 0.5s ease;
        }
        .thermo-dial::after {
          content: ''; position: absolute; inset: 4px; border-radius: 50%; background: var(--bg-surface);
        }
        .thermo-dial svg { position: relative; z-index: 1; width: 18px; height: 18px; color: var(--dial-color); }
        .thermo-dial.pulse { animation: dial-pulse 1.4s ease-in-out infinite; }
        @keyframes dial-pulse { 0%,100% { filter: drop-shadow(0 0 0 rgba(216,67,58,0)); } 50% { filter: drop-shadow(0 0 5px var(--dial-color)); } }

        .sparkline { width: 100%; height: 26px; display: block; margin-top: 2px; }

        /* FANS */
        .fan-tachometer {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          background: var(--bg-surface-alt); padding: 9px; border-radius: var(--r-sm); border: 1px solid var(--line);
          cursor: pointer; transition: all 0.15s ease;
        }
        .fan-tachometer:hover { border-color: var(--info); }
        .fan-spinner-wrap { position: relative; width: 24px; height: 24px; display:flex; align-items:center; justify-content:center; }
        .fan-spinner { width: 22px; height: 22px; animation: spin 2s linear infinite; transform-origin: center; transition: filter 0.3s ease; color: var(--info); }
        .fan-spinner.stopped { animation: none !important; }
        .fan-spinner.blur-low { filter: blur(0.3px); }
        .fan-spinner.blur-med { filter: blur(0.6px); }
        .fan-spinner.blur-high { filter: blur(1px); }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* AMS SPOOLS — Studio's AMS panel: square-ish tiles, thin border,
           left accent bar when active (matches the tool-rail language). */
        .ams-slot {
          background: var(--bg-surface-alt); border: 1px solid var(--line); border-left: 3px solid transparent; border-radius: var(--r-sm); padding: 11px;
          display: flex; flex-direction: column; align-items: center; gap: 7px; cursor: pointer;
          transition: all 0.18s ease; position: relative; overflow: hidden;
        }
        .ams-slot:hover { border-color: var(--brand); }
        .ams-slot.active {
          border-color: var(--brand); border-left-color: var(--brand);
          background: var(--brand-tint);
        }
        .ams-slot.active .spool-center { color: var(--brand-dark); }
        .active-badge {
          position: absolute; top: 7px; right: 7px;
          background: var(--brand); color: #ffffff; font-size: 8.5px; font-weight: 700;
          letter-spacing: 0.3px; text-transform: uppercase; padding: 2px 7px; border-radius: 3px;
          display: none; align-items: center; gap: 4px;
        }
        .ams-slot.active .active-badge { display: flex; }
        .ams-slot.feeding::after {
          content: ''; position: absolute; left: -30%; right: -30%; bottom: 0; height: 3px;
          background: repeating-linear-gradient(90deg, var(--brand) 0 10px, transparent 10px 20px);
          animation: feed-flow 0.7s linear infinite;
        }
        @keyframes feed-flow { from { transform: translateX(0); } to { transform: translateX(20px); } }

        .spool-ring {
          width: 56px; height: 56px; border-radius: 50%; border: 6px solid var(--bg-surface-sunken);
          transition: all 0.3s ease; position: relative;
          background-image: repeating-conic-gradient(rgba(0,0,0,0.035) 0deg 6deg, transparent 6deg 12deg);
        }
        .spool-ring.spinning { animation: spool-spin 2.4s linear infinite; }
        @keyframes spool-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .spool-center {
          position: absolute; inset: 8px; border-radius: 50%; background: var(--bg-surface);
          border: 1px solid var(--line); display: flex; align-items: center; justify-content: center;
          font-size: 8.5px; font-weight: 700; color: var(--ink-mute);
        }
        .material-chip {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
          padding: 2px 7px; border-radius: 3px; background: var(--bg-surface-sunken); color: var(--ink-soft);
        }

        .progress-bar-bg { width: 100%; height: 6px; background: var(--bg-surface-sunken); border-radius: 3px; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: var(--brand); border-radius: 3px; transition: width 0.4s ease; }

        /* PAGINATION */
        .pagination-bar {
          display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
          background: var(--bg-toolbar); padding: 10px 16px; border-radius: var(--r-md); border: 1px solid var(--line);
        }
        .pagination-controls { display: flex; align-items: center; gap: 8px; }
        .page-size-selector {
          background: var(--bg-surface); color: var(--ink); border: 1px solid var(--line-strong);
          padding: 6px 10px; border-radius: var(--r-sm); font-size: 12px; outline: none; cursor: pointer;
        }

        /* HMS BANNER */
        .hms-banner {
          background: var(--warn-tint); border: 1px solid rgba(224,152,59,0.35); border-left: 3px solid var(--warn); color: #f3cd94;
          padding: 12px 16px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 500;
          display: none; align-items: center; gap: 12px;
          max-height: 0; overflow: hidden; opacity: 0; transition: all 0.3s ease;
        }
        .hms-banner.visible { display: flex; max-height: 120px; opacity: 1; }

        /* MODALS */
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
          display: none; align-items: center; justify-content: center; z-index: 2000; padding: 16px; box-sizing: border-box;
        }
        .modal-overlay.open { display: flex; }
        .modal-body {
          background: var(--bg-surface); border: 1px solid var(--line); border-radius: var(--r-lg);
          width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto;
          padding: clamp(18px, 2.6vw, 28px); display: flex; flex-direction: column; gap: 16px;
          box-shadow: var(--shadow-lg); box-sizing: border-box;
          animation: modal-in 0.16s ease;
        }
        @keyframes modal-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

        .input-group { display: flex; flex-direction: column; gap: 6px; }
        .input-group label { font-size: 11px; font-weight: 700; color: var(--ink-soft); }
        .input-group select, .input-group input[type="text"], .input-group input[type="number"] {
          width: 100%; padding: 10px; border-radius: var(--r-sm); background: var(--bg-surface); color: var(--ink);
          border: 1px solid var(--line-strong); font-size: 13px; box-sizing: border-box;
        }
        .input-group input[type="range"] { width: 100%; accent-color: var(--brand); }
        .range-value { font-size: 17px; font-weight: 700; text-align: center; color: var(--ink); }
        .ams-hint { font-size: 11px; color: var(--ink-mute); display: flex; align-items: center; gap: 6px; }
        .ams-hint.warn { color: var(--warn); }

        /* Filament color swatch — a real, clearly-visible color chip plus its
           hex value, instead of a full-width native <input type="color">
           squashed by the shared input padding into a near-invisible sliver. */
        .color-swatch-row { display: flex; align-items: center; gap: 12px; }
        .color-swatch-row input[type="color"] {
          -webkit-appearance: none; appearance: none; width: 52px; height: 40px; padding: 0;
          border: 2px solid var(--line-strong); border-radius: var(--r-md); background: none;
          cursor: pointer; flex: 0 0 auto;
        }
        .color-swatch-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        .color-swatch-row input[type="color"]::-webkit-color-swatch { border: none; border-radius: calc(var(--r-md) - 2px); }
        .color-swatch-row input[type="color"]::-moz-color-swatch { border: none; border-radius: calc(var(--r-md) - 2px); }
        .color-hex-label { font-family: monospace; font-size: 14px; font-weight: 700; color: var(--ink); letter-spacing: 0.5px; }

        /* Read-only filament metadata (nozzle temp range), mirroring the
           "Filament Information" panel on the printer's own touchscreen. */
        .filament-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .filament-meta-item {
          display: flex; flex-direction: column; gap: 4px; padding: 8px 10px;
          background: var(--bg-surface-sunken); border: 1px solid var(--line); border-radius: var(--r-sm);
        }
        .filament-meta-item span { font-size: 10px; font-weight: 700; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.4px; }
        .filament-meta-item strong { font-size: 15px; color: var(--ink); }

        .checkbox-row {
          display: flex; align-items: center; justify-content: space-between; background: var(--bg-surface-alt);
          padding: 9px 12px; border-radius: var(--r-sm); border: 1px solid var(--line);
        }

        .file-list { display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
        .file-item {
          display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
          background: var(--bg-surface); border: 1px solid var(--line); padding: 12px; border-radius: var(--r-sm);
          transition: all 0.15s ease;
        }
        .file-item:hover { border-color: var(--brand); background: var(--brand-tint); }
        .file-item.current-task { border-color: var(--brand); border-left: 3px solid var(--brand); background: var(--brand-tint); }
        .file-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 220px; }
        .file-preview-img { width: 50px; height: 50px; border-radius: var(--r-sm); object-fit: cover; background: var(--bg-surface-sunken); border: 1px solid var(--line); flex-shrink: 0; }
        .file-icon-placeholder { width: 50px; height: 50px; border-radius: var(--r-sm); background: var(--brand-tint); color: var(--brand-dark); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding: 32px 16px; color: var(--ink-mute); text-align:center; }

        #btn-sort-date[data-dir="asc"] svg { transform: scaleY(-1); }
        #btn-sort-date { position: relative; }
        #btn-sort-date::after {
          content: attr(data-dir); position: absolute; bottom: -2px; right: -2px;
          font-size: 7px; font-weight: 700; text-transform: uppercase; color: var(--brand-dark);
          background: var(--bg-surface); border-radius: 3px; padding: 0 2px; line-height: 1.3;
        }

        .file-actions { display: flex; align-items: center; gap: 6px; }
        .icon-btn-ghost {
          background: var(--danger-tint); border: 1px solid rgba(216,67,58,0.3); color: var(--danger);
          width: 34px; height: 34px; border-radius: var(--r-sm); cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;
        }
        .icon-btn-ghost svg { width: 15px; height: 15px; }
        .icon-btn-ghost:hover { background: var(--danger); color: #ffffff; }

        .media-box { position: relative; aspect-ratio: 16/10; background: #101214; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); width: 100%; display:flex; align-items:center; justify-content:center; }
        .media-box ha-camera-stream, .media-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .media-label { position: absolute; top: 6px; left: 6px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; background: rgba(20,22,24,0.6); color: #f1f2f3; padding: 3px 7px; border-radius: 3px; z-index: 2; }
        .media-empty { color: #808689; display:flex; flex-direction:column; align-items:center; gap:8px; font-size: 11px; text-align:center; padding: 12px; }

        /* HOME TAB */
        .home-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px; width: 100%; align-items: start; }
        .home-grid.has-detail { grid-template-columns: 1.3fr 0.85fr 1fr; }
        @media (max-width: 640px) { .home-grid, .home-grid.has-detail { grid-template-columns: 1fr; } }
        .home-live-card { padding: 12px; }
        .home-detail-panel { padding: 12px; gap: 8px; display: flex; flex-direction: column; max-height: 640px; overflow-y: auto; }
        .home-detail-header { display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:700; color: var(--ink); padding-bottom:8px; border-bottom:1px solid var(--line); text-transform: uppercase; letter-spacing: 0.3px; }
        .home-detail-body .modal-body { box-shadow:none; background:transparent; padding:0; max-width:none; width:auto; }
        .home-detail-body .modal-overlay { position:static; display:block; background:transparent; }
        .live-stage-wrap { display: flex; flex-direction: column; gap: 10px; }
        .live-overlay-icons { position: absolute; top: 6px; right: 6px; display: flex; gap: 6px; z-index: 2; }

        .job-progress-strip { display: flex; flex-direction: column; gap: 6px; }
        .job-progress-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-mute); }
        .job-progress-meta strong { color: var(--ink); font-weight: 700; }

        .icon-toolbar { display: flex; align-items: center; justify-content: center; gap: 8px; }
        .icon-btn {
          background: var(--bg-surface-alt); border: 1px solid var(--line-strong); color: var(--ink);
          width: 44px; height: 44px; border-radius: var(--r-sm); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s ease; flex-shrink: 0;
        }
        .icon-btn svg { width: 19px; height: 19px; }
        .icon-btn:hover { background: var(--bg-surface); border-color: var(--ink-faint); }
        .icon-btn.primary { background: var(--brand); border-color: var(--brand); color: #ffffff; }
        .icon-btn.primary:hover { background: var(--brand-dark); }
        .icon-btn.danger { background: var(--danger-tint); border-color: rgba(216,67,58,0.3); color: var(--danger); }
        .icon-btn.danger:hover { background: var(--danger); color: #ffffff; }
        .icon-btn.warn { background: var(--warn-tint); border-color: rgba(224,152,59,0.35); color: var(--warn); }
        .icon-btn.warn:hover { background: var(--warn); color: #ffffff; }
        .icon-btn:disabled { pointer-events: none; }
        .icon-btn.small { width: 32px; height: 32px; border-radius: 3px; background: rgba(20,22,24,0.55); border-color: transparent; color: #f1f2f3; }
        .icon-btn.small svg { width: 14px; height: 14px; }
        .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .icon-btn[data-mode="disabled"] { opacity: 0.4; }
        @keyframes boc-spin-once { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-once svg { animation: boc-spin-once 0.6s ease; }

        .home-side-panel { padding: 12px; gap: 8px; }
        .mini-stat {
          display: flex; align-items: center; gap: 10px; background: var(--bg-surface-alt);
          border: 1px solid var(--line); border-radius: var(--r-sm); padding: 8px 10px;
          cursor: pointer; transition: all 0.15s ease;
        }
        .mini-stat:hover { border-color: var(--brand); }
        .mini-stat-icon { width: 20px; height: 20px; flex-shrink: 0; display:flex; align-items:center; justify-content:center; }
        .mini-stat-icon svg { width: 18px; height: 18px; }
        .mini-stat-body { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
        .mini-stat-label { font-size: 9.5px; font-weight: 700; color: var(--ink-mute); text-transform: uppercase; }
        .mini-stat-value { font-size: 16px; font-weight: 700; color: var(--ink); }
        .mini-divider { height: 1px; background: var(--line); margin: 2px 0; }

        .speed-combo { position: relative; }
        .speed-combo-trigger {
          width: 100%; display: flex; align-items: center; gap: 10px; background: var(--bg-surface-alt);
          border: 1px solid var(--line-strong); border-radius: var(--r-sm); padding: 8px 10px;
          cursor: pointer; color: var(--ink); font: inherit; transition: all 0.15s ease;
        }
        .speed-combo-trigger:hover { border-color: var(--brand); }
        .speed-combo-trigger svg:first-child { width: 18px; height: 18px; color: var(--info); flex-shrink: 0; }
        .speed-combo-trigger span { flex: 1; text-align: left; font-size: 12.5px; font-weight: 600; }
        .speed-combo-trigger .chevron { width: 15px; height: 15px; color: var(--ink-mute); transition: transform 0.2s ease; }
        .speed-combo.open .chevron { transform: rotate(180deg); }
        .speed-combo-list {
          display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 50;
          background: var(--bg-surface); border: 1px solid var(--line-strong); border-radius: var(--r-sm);
          overflow: hidden; box-shadow: var(--shadow-lg);
        }
        .speed-combo.open .speed-combo-list { display: block; }
        .speed-combo-option { padding: 9px 11px; font-size: 12px; font-weight: 500; color: var(--ink-soft); cursor: pointer; }
        .speed-combo-option:hover { background: var(--brand-tint); color: var(--brand-dark); }
        .speed-combo-option.selected { color: var(--brand-dark); font-weight: 700; }

        .swatch-row { display: flex; align-items: center; justify-content: space-between; gap: 7px; padding: 2px 2px; }
        .swatch {
          width: 28px; height: 28px; border-radius: 4px; border: 2px solid var(--bg-surface); cursor: pointer;
          box-shadow: 0 0 0 1px var(--line); transition: all 0.15s ease; flex: 1;
          max-width: 32px;
        }
        .swatch:hover { box-shadow: 0 0 0 1px var(--ink-faint); }
        .swatch.active { box-shadow: 0 0 0 2px var(--brand); }

        /* DEVELOPER TAB */
        .dev-console { background: #1e2226; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 10px; font-family: "Cascadia Code", Consolas, Menlo, monospace; font-size: 11.5px; color: #7be8a0; min-height: 90px; max-height: 260px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
        .dev-hint { font-size: 11px; color: var(--ink-mute); }

        .helper-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .helper-chip {
          background: var(--bg-surface-alt); border: 1px solid var(--line-strong); color: var(--ink-soft);
          padding: 6px 10px; border-radius: var(--r-sm); font-size: 11px; font-weight: 600; cursor: pointer;
          transition: all 0.15s ease;
        }
        .helper-chip:hover { background: var(--bg-surface); border-color: var(--brand); color: var(--brand-dark); }

        .skip-objects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
        .skip-object-tile {
          background: var(--bg-surface-alt); border: 1px solid var(--line); border-left: 2px solid transparent; border-radius: var(--r-sm);
          padding: 9px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px;
          cursor: pointer; transition: all 0.15s ease; text-align: center;
        }
        .skip-object-tile:hover { border-color: var(--brand); border-left-color: var(--brand); }
        .skip-object-tile .obj-name { font-size: 11px; font-weight: 600; color: var(--ink); word-break: break-word; line-height: 1.2; }
        .skip-object-tile .obj-id { font-size: 9px; color: var(--ink-mute); }
        .skip-object-tile .obj-state {
          font-size: 8.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
          padding: 2px 7px; border-radius: 3px; background: var(--brand-tint); color: var(--brand-dark);
        }
        .skip-object-tile.skipped {
          border-color: var(--danger); border-left-color: var(--danger); cursor: not-allowed; opacity: 0.6;
        }
        .skip-object-tile.skipped .obj-state { background: var(--danger-tint); color: var(--danger); }
        .skip-object-tile.skipped .obj-name { text-decoration: line-through; }

        #skip-objects-modal .modal-body { max-width: 440px; }
        .skip-modal-hint { font-size: 12px; color: var(--ink-mute); line-height: 1.5; padding-right: 28px; }
        .skip-close-x {
          position: absolute; top: 12px; right: 12px; background: none; border: none; color: var(--ink-mute);
          width: 28px; height: 28px; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;
          border-radius: var(--r-sm); transition: all 0.15s ease;
        }
        .skip-close-x svg { width: 16px; height: 16px; }
        .skip-close-x:hover { background: var(--bg-surface-alt); color: var(--ink); }
        .skip-pill-btn {
          background: var(--bg-surface-alt); color: var(--ink); border: 1px solid var(--line-strong); border-radius: var(--r-sm);
          padding: 8px 18px; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;
        }
        .skip-pill-btn:hover { background: var(--bg-surface); border-color: var(--ink-faint); }
        .skip-pill-btn.primary { background: var(--info); color: #ffffff; border-color: transparent; }
        .skip-pill-btn.primary:hover { background: #007bb3; }
        .skip-pill-btn.primary:disabled { background: var(--bg-surface-sunken); color: var(--ink-faint); cursor: not-allowed; }
        .skip-image-wrap {
          position: relative; width: 100%; aspect-ratio: 1/1; border-radius: var(--r-md); overflow: hidden;
          background: #101214; border: 1px solid var(--line);
        }
        .skip-image-wrap img, .skip-image-wrap canvas {
          position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
        }
        .skip-image-wrap canvas { cursor: pointer; }
        .skip-image-empty {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          color: #85898c; font-size: 11px; text-align: center; padding: 16px;
        }
        .skip-checklist {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px;
          max-height: 260px; overflow-y: auto; align-content: start;
        }
        @media (max-width: 480px) { .skip-checklist { grid-template-columns: 1fr; } }
        .skip-check-row {
          display: flex; align-items: center; gap: 10px; background: var(--bg-surface-alt); border: 1px solid var(--line);
          border-radius: var(--r-sm); padding: 8px 11px; cursor: pointer; transition: all 0.15s ease;
        }
        .skip-check-row:hover, .skip-check-row.hovered { border-color: var(--info); background: var(--info-tint); }
        .skip-check-row input[type="checkbox"] { accent-color: var(--danger); width: 15px; height: 15px; flex-shrink: 0; }
        .skip-check-row span { font-size: 12px; color: var(--ink); }
        .skip-check-row.already-skipped { opacity: 0.6; }
        .skip-check-row.already-skipped span { text-decoration: line-through; color: var(--danger); }
        .skip-check-row.already-skipped input { cursor: not-allowed; }
      </style>

      <div class="scale-wrap" id="scale-wrap">
      <div class="app-shell" id="app-shell">
        <!-- SIDEBAR NAV -->
        <div class="sidebar">
          <div class="sidebar-brand">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00AE42" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </div>
          <button class="tab-btn active" data-tab="home" title="Monitor & Overview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
            Home
          </button>
          <button class="tab-btn" data-tab="movement" title="Manual Jog & Calib">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
            Move
          </button>
          <button class="tab-btn" data-tab="temps" title="Thermal & Fans">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5V4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/></svg>
            Thermal
          </button>
          <button class="tab-btn" data-tab="ams" title="AMS Filament Matrix">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>
            AMS
          </button>
          <button class="tab-btn" data-tab="history" title="Print Hub & 3MF">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
            Files
          </button>
          <button class="tab-btn" data-tab="system" title="System Telemetry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="var(--bg-surface)"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="var(--bg-surface)"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="var(--bg-surface)"/></svg>
            System
          </button>
          <button class="tab-btn" data-tab="developer" title="Developer / Raw MQTT Actions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            Dev
          </button>
          <div class="sidebar-spacer"></div>
          <button class="power-btn" id="btn-power-socket" title="Toggle Main Power Switch">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="12"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>
          </button>
        </div>

        <div class="main-column">
          <!-- Main Header Bar -->
          <div class="header-bar">
            <div class="brand-box">${this._config.title}</div>
            <div style="display:flex; align-items:center; gap: 12px;">
              <div class="status-pill idle" id="lbl-status"><span class="status-dot"></span><span id="lbl-status-text">STANDBY</span></div>
            </div>
          </div>

          <!-- HMS Diagnostics Warning Banner -->
          <div class="hms-banner" id="hms-banner">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/></svg>
            <div>
              <div style="font-weight:700;">HMS Diagnostic Alert</div>
              <div id="hms-description-text" style="font-size:12px; opacity:0.9;">Checking active system error state...</div>
            </div>
          </div>

          <!-- Main Viewport -->
          <div class="viewport">

            <!-- TAB 1: MONITOR (merged live view + squeezed icon controls) -->
            <div class="tab-pane active" id="pane-home">
              <div class="home-grid" id="home-grid">
                <div class="card home-live-card">
                  <div class="live-stage-wrap">
                    <div class="media-box merged" id="live-media-box">
                      <div class="media-label" id="live-media-label">Live camera</div>
                      <div class="media-empty" id="live-media-empty">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>
                        No live feed
                      </div>
                      <div class="live-overlay-icons">
                        <button class="icon-btn small" id="btn-full-refresh" title="Full state refresh">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        </button>
                        <button class="icon-btn small" id="btn-toggle-light" title="Toggle chamber light">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3.5 3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>
                        </button>
                        <button class="icon-btn small" id="btn-toggle-cam" title="Toggle camera">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                        </button>
                      </div>
                    </div>

                    <div class="job-progress-strip">
                      <div class="progress-bar-bg"><div class="progress-bar-fill" id="home-progress-bar-fill" style="width:0%;"></div></div>
                      <div class="job-progress-meta">
                        <span><strong id="lbl-progress-percent">0%</strong></span>
                        <span>Layer <strong id="lbl-layer-stats">0 / 0</strong></span>
                        <span>ETA <strong id="lbl-remaining-time">--:--:--</strong></span>
                      </div>
                    </div>

                    <div class="icon-toolbar">
                      <button class="icon-btn" id="btn-open-files" title="Print / reprint files">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
                      </button>
                      <button class="icon-btn" id="btn-open-skip" title="Skip objects on the plate" style="color:#c8790f;">
                        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                      </button>
                      <button class="icon-btn" id="btn-open-move" title="Move head / bed">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                      </button>
                      <button class="icon-btn primary" id="btn-resume-job" title="Resume print" disabled>
                        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>
                      </button>
                      <button class="icon-btn warn" id="btn-pause-job" title="Pause print" disabled>
                        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                      </button>
                      <button class="icon-btn danger" id="btn-stop-job" title="Cancel print" disabled>
                        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
                      </button>
                    </div>

                  </div>
                </div>

                <div class="card home-side-panel">
                  <div class="mini-stat" data-edit-temp="nozzle" title="Tap to set nozzle target temperature">
                    <div class="mini-stat-icon" style="color:#d8433a;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5V4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">Nozzle <span id="home-nozzle-target">0</span>°C target</div>
                      <div class="mini-stat-value"><span id="home-nozzle-temp">0</span>°C</div>
                    </div>
                  </div>
                  <div class="mini-stat" data-edit-temp="bed" title="Tap to set bed target temperature">
                    <div class="mini-stat-icon" style="color:#c8790f;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1.5"/><line x1="4" y1="10" x2="20" y2="10"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">Bed <span id="home-bed-target">0</span>°C target</div>
                      <div class="mini-stat-value"><span id="home-bed-temp">0</span>°C</div>
                    </div>
                  </div>

                  <div class="mini-divider"></div>

                  <div class="speed-combo" id="home-speed-combo">
                    <button class="speed-combo-trigger" id="home-speed-trigger" type="button">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1A9 9 0 1 1 19.1 19.1"/><line x1="12" y1="13" x2="16" y2="8"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/></svg>
                      <span id="home-speed-label">Standard (100%)</span>
                      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div class="speed-combo-list" id="home-speed-list">
                      <div class="speed-combo-option" data-speed="silent">Silent (50%)</div>
                      <div class="speed-combo-option" data-speed="standard">Standard (100%)</div>
                      <div class="speed-combo-option" data-speed="sport">Sport (124%)</div>
                      <div class="speed-combo-option" data-speed="ludicrous">Ludicrous (166%)</div>
                    </div>
                  </div>

                  <div class="mini-stat" data-edit-fan="fan_part_entity" data-fan-label="Part Cooling Fan" title="Tap to set part cooling fan speed">
                    <div class="mini-stat-icon" style="color:#00AE42;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">Part cooling fan</div>
                      <div class="mini-stat-value" id="home-fan-part-val">0%</div>
                    </div>
                  </div>

                  <div class="mini-stat" style="cursor:default;" title="Live current draw from the mains smart plug">
                    <div class="mini-stat-icon" style="color:#2e8fd6;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">Current</div>
                      <div class="mini-stat-value" id="home-power-current">-- A</div>
                    </div>
                  </div>
                  <div class="mini-stat" style="cursor:default;" title="Live power draw from the mains smart plug">
                    <div class="mini-stat-icon" style="color:#2e8fd6;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">Power now</div>
                      <div class="mini-stat-value" id="home-power-now">-- W</div>
                    </div>
                  </div>
                  <div class="mini-stat" style="cursor:default;" title="Lifetime energy total from the mains smart plug">
                    <div class="mini-stat-icon" style="color:#6b7686;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">Total energy</div>
                      <div class="mini-stat-value" id="home-power-total">-- kWh</div>
                    </div>
                  </div>
                  <div class="mini-stat" style="cursor:default;" title="Total energy consumed since the current/last print started (total energy minus the reading captured at print start)">
                    <div class="mini-stat-icon" style="color:#00AE42;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
                    <div class="mini-stat-body">
                      <div class="mini-stat-label">This print</div>
                      <div class="mini-stat-value" id="home-power-print">-- kWh</div>
                    </div>
                  </div>

                  <div class="mini-divider"></div>

                  <div class="mini-stat-label" style="padding:0 2px;">AMS filament slots — tap to sync</div>
                  <div class="swatch-row" id="home-ams-swatches">
                    <div class="swatch" id="home-ams-swatch-0" data-tray="0" title="AMS Slot 1"></div>
                    <div class="swatch" id="home-ams-swatch-1" data-tray="1" title="AMS Slot 2"></div>
                    <div class="swatch" id="home-ams-swatch-2" data-tray="2" title="AMS Slot 3"></div>
                    <div class="swatch" id="home-ams-swatch-3" data-tray="3" title="AMS Slot 4"></div>
                  </div>
                </div>

                <!-- DOCKED DETAIL PANEL — Skip Objects / Move / Filament render
                     here, next to the always-visible camera, instead of a
                     full-screen modal. Populated by reparenting the real
                     content (so all existing logic/ids keep working) and
                     restored to its original home when closed. -->
                <div class="card home-detail-panel" id="home-detail-panel" style="display:none;">
                  <div class="home-detail-header">
                    <span id="home-detail-title">Details</span>
                    <button class="icon-btn small" id="btn-home-detail-close" title="Close">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div class="home-detail-body" id="home-detail-body"></div>
                </div>
              </div>
            </div>

            <!-- TAB 2: PRINT HUB & REPRINT -->
            <div class="tab-pane" id="pane-history">
              <div class="card">
                <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px;">
                  <span class="card-title" style="margin:0;">MICROSD & CACHED 3MF LIBRARY</span>
                  <button class="btn primary" id="btn-refresh-history" style="padding:6px 14px; font-size:12px;">Refresh Library</button>
                </div>

                <div class="pagination-bar">
                  <div style="display:flex; align-items:center; gap:8px; font-size:13px; color:#6b7686;">
                    <span>Items per page:</span>
                    <select class="page-size-selector" id="sel-page-size">
                      <option value="5">5</option>
                      <option value="10" selected>10</option>
                      <option value="15">15</option>
                      <option value="20">20</option>
                    </select>
                    <button class="icon-btn small" id="btn-sort-date" data-dir="desc" title="Sort by created date: newest first">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14.5"/></svg>
                    </button>
                  </div>
                  <div class="pagination-controls">
                    <span id="lbl-page-range" style="font-size:13px; font-weight:600; color:#17202b;">Showing 0 of 0</span>
                    <button class="btn" id="btn-page-prev" style="padding:6px 12px; font-size:12px;">&laquo; Prev</button>
                    <button class="btn" id="btn-page-next" style="padding:6px 12px; font-size:12px;">Next &raquo;</button>
                  </div>
                </div>

                <div class="file-list" id="reprint-file-container"></div>
              </div>
            </div>

            <!-- TAB 3: THERMAL & FANS -->
            <div class="tab-pane" id="pane-temps">
              <div class="grid-responsive-2">
                <div class="card">
                  <div class="card-title">THERMAL CONTROLS <span class="edit-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Tap to edit</span></div>
                  <div style="display:flex; flex-direction:column; gap:16px;">
                    <div class="thermo-row" id="temps-nozzle-row" data-edit-temp="nozzle">
                      <div class="thermo-dial" id="temps-nozzle-dial" style="--dial-color:#d8433a;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5V4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/></svg>
                      </div>
                      <div style="flex:1; min-width:0;">
                        <div style="font-size:11px; color:#6b7686; font-weight:700;">TOOLHEAD TEMP</div>
                        <div style="font-size:15px; font-weight:800;"><span id="lbl-nozzle-temp" style="color:#d8433a;">--</span>°C / Target: <span id="lbl-nozzle-target">--</span>°C</div>
                        <svg class="sparkline" id="temps-nozzle-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline fill="none" stroke="#d8433a" stroke-width="2" points=""></polyline></svg>
                      </div>
                    </div>
                    <div class="grid-3">
                      <button class="btn" id="set-nozzle-0">0°C</button>
                      <button class="btn" id="set-nozzle-210">210°C (PLA)</button>
                      <button class="btn" id="set-nozzle-250">250°C (PETG)</button>
                    </div>

                    <div class="thermo-row" id="temps-bed-row" data-edit-temp="bed">
                      <div class="thermo-dial" id="temps-bed-dial" style="--dial-color:#c8790f;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1.5"/><line x1="4" y1="10" x2="20" y2="10"/></svg>
                      </div>
                      <div style="flex:1; min-width:0;">
                        <div style="font-size:11px; color:#6b7686; font-weight:700;">HEATBED TEMP</div>
                        <div style="font-size:15px; font-weight:800;"><span id="lbl-bed-temp" style="color:#c8790f;">--</span>°C / Target: <span id="lbl-bed-target">--</span>°C</div>
                        <svg class="sparkline" id="temps-bed-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline fill="none" stroke="#c8790f" stroke-width="2" points=""></polyline></svg>
                      </div>
                    </div>
                    <div class="grid-3">
                      <button class="btn" id="set-bed-0">0°C</button>
                      <button class="btn" id="set-bed-55">55°C (PLA)</button>
                      <button class="btn" id="set-bed-80">80°C (PETG)</button>
                    </div>
                  </div>
                </div>

                <div class="card">
                  <div class="card-title">COOLING TACHOMETERS & SPEED MODES <span class="edit-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Tap to edit</span></div>
                  <div class="grid-3">
                    <div class="fan-tachometer" id="fan-part-box" data-edit-fan="fan_part_entity" data-fan-label="Part Cooling Fan">
                      <div style="font-size:10px; font-weight:700; color:#6b7686;">PART COOLING</div>
                      <div class="fan-spinner-wrap"><svg class="fan-spinner" id="fan-part-icon" viewBox="0 0 24 24" fill="none" stroke="#00AE42" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/></svg></div>
                      <div style="font-size:13px; font-weight:800;" id="lbl-fan-part-val">--%</div>
                    </div>
                    <div class="fan-tachometer" id="fan-aux-box" data-edit-fan="fan_aux_entity" data-fan-label="Auxiliary Fan">
                      <div style="font-size:10px; font-weight:700; color:#6b7686;">AUXILIARY</div>
                      <div class="fan-spinner-wrap"><svg class="fan-spinner" id="fan-aux-icon" viewBox="0 0 24 24" fill="none" stroke="#0091d1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/></svg></div>
                      <div style="font-size:13px; font-weight:800;" id="lbl-fan-aux-val">--%</div>
                    </div>
                    <div class="fan-tachometer" id="fan-chamber-box" data-edit-fan="fan_chamber_entity" data-fan-label="Exhaust Fan">
                      <div style="font-size:10px; font-weight:700; color:#6b7686;">EXHAUST</div>
                      <div class="fan-spinner-wrap"><svg class="fan-spinner" id="fan-chamber-icon" viewBox="0 0 24 24" fill="none" stroke="#c8790f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/></svg></div>
                      <div style="font-size:13px; font-weight:800;" id="lbl-fan-chamber-val">--%</div>
                    </div>
                  </div>

                  <div class="card-title" style="margin-top:8px;">PRINT SPEED MODES</div>
                  <div class="grid-3">
                    <button class="btn" id="sp-silent">Silent (50%)</button>
                    <button class="btn primary" id="sp-standard">Standard (100%)</button>
                    <button class="btn" id="sp-sport">Sport (124%)</button>
                    <button class="btn danger" id="sp-ludicrous">Ludicrous (166%)</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- TAB 4: MANUAL JOG & CALIBRATION -->
            <div class="tab-pane" id="pane-movement">
              <div class="grid-responsive-2">
                <div class="card">
                  <div class="card-title">PRECISION AXIS JOGGING</div>
                  <div class="grid-4">
                    <button class="btn" id="jog-step-01">0.1 mm</button>
                    <button class="btn" id="jog-step-1">1 mm</button>
                    <button class="btn primary" id="jog-step-10">10 mm</button>
                    <button class="btn" id="jog-step-50">50 mm</button>
                  </div>
                  <div style="display:flex; justify-content:center;"><button class="btn" id="btn-jog-yp" style="width:52px; height:52px;">Y+</button></div>
                  <div style="display:flex; justify-content:center; gap:12px;">
                    <button class="btn" id="btn-jog-xm" style="width:52px; height:52px;">X-</button>
                    <button class="btn primary" id="btn-jog-home" style="width:52px; height:52px;">HOME</button>
                    <button class="btn" id="btn-jog-xp" style="width:52px; height:52px;">X+</button>
                  </div>
                  <div style="display:flex; justify-content:center;"><button class="btn" id="btn-jog-ym" style="width:52px; height:52px;">Y-</button></div>
                  <div style="display:flex; justify-content:center; gap:12px; margin-top:8px;">
                    <button class="btn" id="btn-jog-zp">Z+ Up</button>
                    <button class="btn" id="btn-jog-zm">Z- Down</button>
                  </div>
                </div>

                <div class="card">
                  <div class="card-title">CALIBRATION & MANUAL EXTRUSION</div>
                  <button class="btn primary" id="btn-exec-abl">Execute Auto Bed Leveling (ABL)</button>
                  <button class="btn" id="btn-exec-vibration">Vibration Compensation / Input Shaping</button>
                  <div style="display:flex; gap:12px; margin-top:8px;">
                    <button class="btn" id="btn-extrude-10" style="flex:1;">Extrude 10mm</button>
                    <button class="btn" id="btn-retract-10" style="flex:1;">Retract 10mm</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- TAB 5: AMS FILAMENT MATRIX -->
            <div class="tab-pane" id="pane-ams">
              <div class="card">
                <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px;">
                  <span class="card-title" style="margin:0;">BAMBU AMS SLOTS MATRIX</span>
                  <span style="font-size:13px; color:#6b7686;">Humidity: <strong id="lbl-ams-hum" style="color:#17202b;">--</strong> | Temp: <strong id="lbl-ams-temp" style="color:#17202b;">--</strong>°C</span>
                </div>
                <div class="grid-4">
                  <div class="ams-slot" id="ams-slot-0">
                    <div class="active-badge">● Active</div>
                    <div class="spool-ring" id="spool-color-0"><div class="spool-center">SLOT 1</div></div>
                    <div style="font-weight:700; font-size:14px;" id="spool-mat-0">--</div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill" id="spool-remain-bar-0" style="width:0%;"></div></div>
                    <div style="font-size:11px; color:#6b7686;" id="spool-remain-lbl-0">--% Remaining</div>
                  </div>
                  <div class="ams-slot" id="ams-slot-1">
                    <div class="active-badge">● Active</div>
                    <div class="spool-ring" id="spool-color-1"><div class="spool-center">SLOT 2</div></div>
                    <div style="font-weight:700; font-size:14px;" id="spool-mat-1">--</div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill" id="spool-remain-bar-1" style="width:0%;"></div></div>
                    <div style="font-size:11px; color:#6b7686;" id="spool-remain-lbl-1">--% Remaining</div>
                  </div>
                  <div class="ams-slot" id="ams-slot-2">
                    <div class="active-badge">● Active</div>
                    <div class="spool-ring" id="spool-color-2"><div class="spool-center">SLOT 3</div></div>
                    <div style="font-weight:700; font-size:14px;" id="spool-mat-2">--</div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill" id="spool-remain-bar-2" style="width:0%;"></div></div>
                    <div style="font-size:11px; color:#6b7686;" id="spool-remain-lbl-2">--% Remaining</div>
                  </div>
                  <div class="ams-slot" id="ams-slot-3">
                    <div class="active-badge">● Active</div>
                    <div class="spool-ring" id="spool-color-3"><div class="spool-center">SLOT 4</div></div>
                    <div style="font-weight:700; font-size:14px;" id="spool-mat-3">--</div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill" id="spool-remain-bar-3" style="width:0%;"></div></div>
                    <div style="font-size:11px; color:#6b7686;" id="spool-remain-lbl-3">--% Remaining</div>
                  </div>
                </div>
              </div>

              <div class="card">
                <div class="card-title">EXTERNAL REAR SPOOL MOUNT</div>
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:20px;">
                  <div class="ams-slot" id="ext-spool-slot" style="width:160px;">
                    <div class="spool-ring" id="ext-spool-color"><div class="spool-center">EXT</div></div>
                    <div style="font-weight:700; font-size:14px;" id="ext-spool-mat">--</div>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:6px; font-size:13px; flex:1;">
                    <div>Feeder Status: <strong id="ext-spool-status" style="color:#049238;">--</strong></div>
                    <div style="color:#6b7686;">Direct PTFE tube bypass feeder for high-flexibility filaments (TPU, PVA) and materials that skip the AMS.</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- TAB 6: SYSTEM TELEMETRY -->
            <div class="tab-pane" id="pane-system">
              <div class="card">
                <div class="card-title">NETWORK & FIRMWARE TELEMETRY</div>
                <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
                  <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid rgba(23,32,43,0.08);"><span>IP Address:</span><strong id="sys-ip">--</strong></div>
                  <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid rgba(23,32,43,0.08);"><span>Wi-Fi Signal:</span><strong id="sys-wifi">-- dBm</strong></div>
                  <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid rgba(23,32,43,0.08);"><span>Total Work Time:</span><strong id="sys-hours">-- Hours</strong></div>
                  <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid rgba(23,32,43,0.08);"><span>MQTT Protocol State:</span><strong id="sys-mqtt">--</strong></div>
                  <div style="display:flex; justify-content:space-between;"><span>SD Card Storage State:</span><strong id="sys-sd">--</strong></div>
                </div>
              </div>
            </div>

            <!-- TAB 7: DEVELOPER / RAW MQTT ACTIONS -->
            <div class="tab-pane" id="pane-developer">
              <div class="grid-responsive-2">
                <div class="card">
                  <div class="card-title">SEND RAW G-CODE</div>
                  <div class="dev-hint">Uses <code>bambu_lab.send_command</code>. Only works while the printer is idle — sending G-code mid-print can crash the job.</div>
                  <div class="helper-row" id="dev-gcode-helpers">
                    <span class="helper-chip" data-gcode="G28">Home All (G28)</span>
                    <span class="helper-chip" data-gcode="M104 S0">Nozzle Off</span>
                    <span class="helper-chip" data-gcode="M140 S0">Bed Off</span>
                    <span class="helper-chip" data-gcode="M106 S255">Fan Full</span>
                    <span class="helper-chip" data-gcode="M107">Fan Off</span>
                    <span class="helper-chip" data-gcode="M400">Wait For Moves</span>
                  </div>
                  <div class="input-group">
                    <input type="text" id="dev-gcode-input" placeholder="e.g. M104 S200">
                  </div>
                  <button class="btn primary" id="dev-send-gcode">Send Command</button>
                </div>

                <div class="card">
                  <div class="card-title">AMS FILAMENT DRYING</div>
                  <div class="dev-hint">Uses <code>bambu_lab.start_filament_drying</code> / <code>stop_filament_drying</code>. AMS 2 max 65°C, AMS HT max 85°C.</div>
                  <div class="input-group">
                    <label>Temperature (°C)</label>
                    <input type="number" id="dev-dry-temp" value="55" min="20" max="85">
                  </div>
                  <div class="input-group">
                    <label>Duration (hours)</label>
                    <input type="number" id="dev-dry-hours" value="4" min="1" max="24">
                  </div>
                  <div class="checkbox-row">
                    <label for="dev-dry-rotate" style="font-size:13px; font-weight:600;">Rotate tray while drying</label>
                    <input type="checkbox" id="dev-dry-rotate" checked style="width:18px; height:18px;">
                  </div>
                  <div style="display:flex; gap:10px;">
                    <button class="btn primary" style="flex:1;" id="dev-dry-start">Start Drying</button>
                    <button class="btn danger" style="flex:1;" id="dev-dry-stop">Stop Drying</button>
                  </div>
                </div>

                <div class="card">
                  <div class="card-title">EXTERNAL SPOOL LOAD ASSIST</div>
                  <div class="dev-hint">If a manual external-spool load gets stuck mid-way, retry the feed or tell the printer you've finished manually.</div>
                  <div class="grid-3">
                    <button class="btn" id="dev-retry-load">Retry Load</button>
                    <button class="btn primary" id="dev-done-load">Done Loading</button>
                    <button class="btn" id="dev-read-rfid">Re-read RFID</button>
                  </div>
                  <div class="dev-hint">"Re-read RFID" targets whichever AMS slot you last opened in the Filament modal (defaults to Slot 1).</div>
                </div>

                <div class="card">
                  <div class="card-title">SKIP OBJECTS <span class="edit-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Tap an object to skip it</span></div>
                  <div class="dev-hint">Auto-discovers this printer's <code>printable_objects</code> entity from the entity registry (no config needed) and calls <code>bambu_lab.skip_objects</code> per tap. Skipping is <strong>irreversible</strong> on the printer — a tile can't be un-skipped once sent.</div>
                  <div class="skip-objects-grid" id="dev-skip-objects-grid">
                    <div class="dev-hint" id="dev-skip-objects-empty">No <code>printable_objects_entity</code> configured, or no objects reported right now — falling back to manual entry below.</div>
                  </div>
                  <div class="input-group">
                    <label>Manual object IDs (fallback)</label>
                    <input type="text" id="dev-skip-ids" placeholder="e.g. 409,1463">
                  </div>
                  <button class="btn danger" id="dev-skip-send">Skip Objects</button>
                </div>

                <div class="card">
                  <div class="card-title">FILAMENT DATABASE DUMP</div>
                  <div class="dev-hint">Uses <code>bambu_lab.get_filament_data</code> to pull every filament profile (including custom ones) the printer currently knows about.</div>
                  <button class="btn" id="dev-get-filament-data">Fetch Filament Data</button>
                  <div class="dev-console" id="dev-console-filament">// response will appear here</div>
                </div>

                <div class="card">
                  <div class="card-title">RAW MQTT CONSOLE</div>
                  <div class="dev-hint">Anything else the <code>bambu_lab</code> integration doesn't expose as a service can still be sent as a raw <code>print</code> command over <code>device/&lt;id&gt;/request</code>. Be careful — this bypasses all of the integration's safety checks.</div>
                  <div class="helper-row" id="dev-mqtt-helpers">
                    <span class="helper-chip" data-mqtt='{"command":"pause"}'>Pause</span>
                    <span class="helper-chip" data-mqtt='{"command":"resume"}'>Resume</span>
                    <span class="helper-chip" data-mqtt='{"command":"stop"}'>Stop</span>
                    <span class="helper-chip" data-mqtt='{"command":"unload_filament"}'>Unload Filament</span>
                  </div>
                  <div class="input-group">
                    <label>JSON payload (wrapped automatically in <code>{"print": ...}</code>)</label>
                    <textarea id="dev-mqtt-payload" rows="4" style="width:100%; padding:12px; border-radius:12px; background:#f4f6f9; color:#17202b; border:1px solid rgba(23,32,43,0.12); font-family:monospace; font-size:12px; box-sizing:border-box;" placeholder='{"command":"gcode_line","param":"M104 S200"}'></textarea>
                  </div>
                  <button class="btn primary" id="dev-mqtt-send">Publish to device/&lt;id&gt;/request</button>
                  <div class="dev-hint" style="margin-top:4px;">Need a full status refresh instead? <code>pushall</code> lives under a different top-level key than <code>print</code>, so it has its own button — don't send it more than once every few minutes, it can lag the printer.</div>
                  <button class="btn" id="dev-mqtt-pushall">Request Full State Refresh (pushall)</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
      </div>

      <!-- TEMPERATURE EDIT MODAL -->
      <div class="modal-overlay" id="temp-modal">
        <div class="modal-body">
          <div style="font-weight:800; font-size:18px;" id="temp-modal-title">Set Target Temperature</div>
          <div class="input-group">
            <label>Target Temperature (°C)</label>
            <input type="range" id="temp-modal-range" min="0" max="320" step="1" value="0">
            <div class="range-value"><span id="temp-modal-value">0</span>°C</div>
          </div>
          <div class="grid-3" id="temp-modal-presets"></div>
          <div style="display:flex; gap:12px; margin-top:8px;">
            <button class="btn" style="flex:1;" id="btn-temp-modal-cancel">Cancel</button>
            <button class="btn primary" style="flex:1;" id="btn-temp-modal-apply">Set Temperature</button>
          </div>
        </div>
      </div>

      <!-- FAN SPEED EDIT MODAL -->
      <div class="modal-overlay" id="fan-modal">
        <div class="modal-body">
          <div style="font-weight:800; font-size:18px;" id="fan-modal-title">Set Fan Speed</div>
          <div class="input-group">
            <label>Speed (%)</label>
            <input type="range" id="fan-modal-range" min="0" max="100" step="1" value="0">
            <div class="range-value"><span id="fan-modal-value">0</span>%</div>
          </div>
          <div class="grid-4">
            <button class="btn" data-fan-preset="0">Off</button>
            <button class="btn" data-fan-preset="25">25%</button>
            <button class="btn" data-fan-preset="75">75%</button>
            <button class="btn" data-fan-preset="100">100%</button>
          </div>
          <div style="display:flex; gap:12px; margin-top:8px;">
            <button class="btn" style="flex:1;" id="btn-fan-modal-cancel">Cancel</button>
            <button class="btn primary" style="flex:1;" id="btn-fan-modal-apply">Set Speed</button>
          </div>
        </div>
      </div>

      <!-- FILAMENT EDIT MODAL -->
      <div class="modal-overlay" id="ams-modal">
        <div class="modal-body">
          <div style="font-weight:800; font-size:18px;" id="ams-modal-title">AMS / Spool Filament Sync</div>
          <div class="input-group">
            <label>Filament Type</label>
            <select id="modal-type-select"></select>
          </div>
          <div class="input-group">
            <label>Filament</label>
            <select id="modal-mat-select"></select>
          </div>
          <div class="ams-hint" id="modal-ams-hint"></div>
          <div class="input-group">
            <label>Color</label>
            <div class="color-swatch-row">
              <input type="color" id="modal-color-select" value="#00AE42">
              <span class="color-hex-label" id="modal-color-hex-label">#00AE42</span>
            </div>
          </div>
          <div class="filament-meta-grid">
            <div class="filament-meta-item"><span>Nozzle Min</span><strong id="modal-meta-tempmin">190°C</strong></div>
            <div class="filament-meta-item"><span>Nozzle Max</span><strong id="modal-meta-tempmax">230°C</strong></div>
          </div>
          <div class="grid-3" id="ams-modal-actions"></div>
          <div style="display:flex; gap:12px; margin-top:8px;">
            <button class="btn" style="flex:1;" id="btn-modal-cancel">Cancel</button>
            <button class="btn primary" style="flex:1;" id="btn-modal-apply">Sync to Printer</button>
          </div>
        </div>
      </div>

      <!-- HANDY REPRINT MODAL -->
      <div class="modal-overlay" id="reprint-modal">
        <div class="modal-body">
          <div style="font-weight:800; font-size:18px;">Execute 3MF Project Job</div>
          <div class="input-group">
            <label>Target 3MF File</label>
            <input type="text" id="reprint-file-name-display" readonly value="--">
          </div>

          <div class="input-group">
            <label>Filament → Tray Mapping (one row per filament/color used in the file)</label>
            <div id="reprint-mapping-rows"></div>
            <button class="btn" id="btn-reprint-add-mapping" style="margin-top:6px; font-size:12px; padding:6px 10px;">+ Add filament</button>
          </div>

          <div class="input-group">
            <label>Plate Number</label>
            <input type="number" id="reprint-plate-number" value="1" min="1" max="16">
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <div class="checkbox-row">
              <label for="chk-use-ams" style="font-size:13px; font-weight:600;">Enable AMS System</label>
              <input type="checkbox" id="chk-use-ams" checked style="width:18px; height:18px;">
            </div>
            <div class="checkbox-row">
              <label for="chk-bed-leveling" style="font-size:13px; font-weight:600;">Auto Bed Leveling (ABL)</label>
              <input type="checkbox" id="chk-bed-leveling" checked style="width:18px; height:18px;">
            </div>
            <div class="checkbox-row">
              <label for="chk-flow-cali" style="font-size:13px; font-weight:600;">Flow Dynamics Calibration</label>
              <input type="checkbox" id="chk-flow-cali" style="width:18px; height:18px;">
            </div>
            <div class="checkbox-row">
              <label for="chk-vibration-cali" style="font-size:13px; font-weight:600;">Vibration Compensation (XY Mech Sweep)</label>
              <input type="checkbox" id="chk-vibration-cali" style="width:18px; height:18px;">
            </div>
            <div class="checkbox-row">
              <label for="chk-layer-inspect" style="font-size:13px; font-weight:600;">First Layer Inspection</label>
              <input type="checkbox" id="chk-layer-inspect" style="width:18px; height:18px;">
            </div>
            <div class="checkbox-row">
              <label for="chk-timelapse" style="font-size:13px; font-weight:600;">Record Timelapse Video</label>
              <input type="checkbox" id="chk-timelapse" checked style="width:18px; height:18px;">
            </div>
          </div>
          <div class="dev-hint">Fields match <code>bambu_lab.print_project_file</code> 1:1 (filepath, plate, use_ams, ams_mapping, bed_leveling, flow_cali, vibration_cali, layer_inspect, timelapse) — nothing here is sent that the integration doesn't actually document.</div>

          <div style="display:flex; gap:12px; margin-top:8px;">
            <button class="btn" style="flex:1;" id="btn-reprint-modal-cancel">Cancel</button>
            <button class="btn primary" style="flex:1;" id="btn-reprint-modal-confirm">Start Print</button>
          </div>
        </div>
      </div>

      <!-- SKIP OBJECTS MODAL — tap an object on the plate image or the list -->
      <div class="modal-overlay" id="skip-objects-modal">
        <div class="modal-body" style="position:relative;">
          <button class="skip-close-x" id="btn-skip-modal-close" title="Close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div class="skip-modal-hint">Select the object(s) you want to skip printing by tapping them in the image or the list.</div>

          <div class="skip-image-wrap" id="skip-image-wrap">
            <img id="skip-build-plate" style="display:none;">
            <canvas id="skip-canvas" width="512" height="512" style="display:none;"></canvas>
            <div class="skip-image-empty" id="skip-image-empty">No <code>pick_image</code> entity found for this printer yet — use the list below to select objects.</div>
          </div>

          <div class="skip-checklist" id="skip-checklist"></div>

          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
            <button class="skip-pill-btn" id="btn-skip-modal-cancel">Cancel</button>
            <button class="skip-pill-btn primary" id="btn-skip-modal-confirm">Skip</button>
          </div>
        </div>
      </div>
    `;

    this._bindAllInteractions();
  }

  // ==========================================================================
  // FILAMENT CATALOG UI
  // ==========================================================================
  // Calls bambu_lab.get_filament_data. Per the integration's own docs this
  // action is targeted with `device_id` (not `entity_id` — the previous
  // version of this targeted an AMS tray entity instead, which is why the
  // dumped profiles were coming back in a shape our parser didn't recognize
  // and every field silently fell back to a default). The service returns
  // "a json string" per the docs, so the raw response may need parsing
  // rather than being a ready-made object/array.
  async _fetchFilamentDataFromPrinter() {
    if (!this._hass) throw new Error('No hass object yet.');
    const deviceId = this._config.device_id;
    if (!deviceId) {
      throw new Error('No device_id configured on this card — get_filament_data needs one to target.');
    }
    const result = await this._hass.callService('bambu_lab', 'get_filament_data', { device_id: deviceId }, undefined, true, true);
    let payload = result?.response ?? result;
    // The action can return its JSON as a string rather than an already-
    // parsed object — try to parse it, and unwrap one more level if the
    // parsed result is itself a string (double-encoded).
    for (let i = 0; i < 2 && typeof payload === 'string'; i++) {
      try { payload = JSON.parse(payload); } catch { break; }
    }
    return payload;
  }

  // Turns the get_filament_data response into a catalog group and merges
  // it into the AMS dropdown as its own "My Printer's Filaments" group —
  // this becomes the actual source for what shows up in the AMS/reprint
  // filament selectors, instead of only the static Bambu Handy list.
  //
  // Defensive about shape, because different integration versions/response
  // modes have been observed to return this data three different ways:
  //   1. A list of per-filament objects.
  //   2. A dict keyed by filament id, one object per filament.
  //   3. A single "columnar" object where EVERY field is an array and the
  //      Nth element of each array belongs to the Nth filament (this is the
  //      shape Bambu Studio's own project_settings.config uses, e.g.
  //      `{ filament_type: ["PLA"], filament_ids: ["P9816594"], ... }`) —
  //      the previous version of this parser treated shape 3 as a single
  //      malformed "filament" (or as raw array values with no matching
  //      keys), so name/type/idx all silently fell back to their defaults
  //      instead of reading real data.
  // Field names are also tried across both the `tray_*` naming used by the
  // live AMS/tray sensors AND the `filament_*` naming Bambu Studio/Handy use
  // for stored filament profiles (filament_type, filament_ids/filament_id,
  // filament_settings_id, filament_colour) — get_filament_data pulls from
  // the profile database, not the live tray state, so the `filament_*`
  // names are the ones that actually show up in practice. Every field is
  // also unwrapped if it arrives as a single-element array.
  _applyFilamentDumpToCatalog(payload) {
    const unwrap = (v) => Array.isArray(v) ? v[0] : v;
    const pick = (raw, ...keys) => {
      for (const k of keys) {
        const v = unwrap(raw?.[k]);
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };

    // `entries` becomes an array of { key, raw } pairs so we never lose the
    // outer id. Real dumps from `get_filament_data` come back keyed by the
    // actual Bambu profile id itself (e.g. "GFA00": { name, filament_vendor,
    // filament_type, nozzle_temperature_range_low/high, ... } — no id field
    // inside the object at all). Previously this code did
    // `Object.values(payload)` and threw that key away entirely, so every
    // profile pulled this way ended up with idx: '' and hit the "Basic"
    // fallback at apply time — that was the actual cause of brands reverting.
    let entries;
    if (Array.isArray(payload)) {
      entries = payload.map(raw => ({ key: null, raw }));
    } else if (payload && typeof payload === 'object') {
      const values = Object.values(payload);
      const looksColumnar = values.length > 0 && values.every(v => Array.isArray(v));
      if (looksColumnar) {
        // Zip the parallel arrays back into one object per filament.
        const keys = Object.keys(payload);
        const count = Math.max(...values.map(v => v.length));
        entries = [];
        for (let i = 0; i < count; i++) {
          const entry = {};
          for (const k of keys) entry[k] = payload[k][i];
          entries.push({ key: null, raw: entry });
        }
      } else {
        // Object-of-objects, keyed by profile id — the common shape.
        entries = Object.entries(payload).map(([key, raw]) => ({ key, raw }));
      }
    } else {
      entries = [];
    }

    const items = [];
    for (const { key, raw } of entries) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const vendor = pick(raw, 'filament_vendor', 'vendor', 'tray_sub_brands');
      let name = pick(raw, 'filament_settings_id', 'name', 'filament_name', 'filament_type', 'tray_type') || 'Custom Filament';
      if (vendor) {
        // Only prefix the vendor if NONE of its words already appear in the
        // name — a plain substring check ("Bambu Lab" in "Bambu PLA Tough+")
        // fails because the name already carries "Bambu" but not "Lab",
        // which previously produced "Bambu Lab Bambu PLA Tough+".
        const vendorWords = String(vendor).toLowerCase().split(/\s+/).filter(Boolean);
        const nameLower = String(name).toLowerCase();
        const alreadyCredited = vendorWords.some(w => w.length > 2 && nameLower.includes(w));
        if (!alreadyCredited) name = `${vendor} ${name}`;
      }
      const type = pick(raw, 'tray_type', 'filament_type', 'type', 'material') || 'PLA';
      let color = pick(raw, 'tray_color', 'filament_colour', 'filament_color', 'color', 'tray_col') || '888888';
      color = String(color).replace(/^#/, '');
      // tray_color from the printer is often 8-hex RGBA (e.g. "00AE42FF") —
      // keep only the 6-hex RGB portion for the <input type="color"> swatch.
      if (color.length >= 6) color = color.slice(0, 6);
      color = `#${color}`;
      // Prefer the real profile id (the dict key) over any field inside the
      // object — the key IS the id in the shape the printer actually returns.
      const idx = key || pick(raw, 'tray_info_idx', 'filament_ids', 'filament_id', 'idx', 'setting_id') || '';
      const tempMin = Number(pick(raw, 'nozzle_temp_min', 'nozzle_temperature_range_low', 'tempMin')) || 190;
      const tempMax = Number(pick(raw, 'nozzle_temp_max', 'nozzle_temperature_range_high', 'tempMax')) || 230;
      items.push({ name, color, tempMin, tempMax, ams: true, idx, type });
    }
    if (!items.length) return 0;

    this._printerFilamentGroup = { group: "My Printer's Filaments", items };
    const withoutOld = this._bambuFilamentCatalog.filter(g => g.group !== "My Printer's Filaments");
    this._bambuFilamentCatalog = [this._printerFilamentGroup, ...withoutOld];
    this._flatFilamentCatalog = this._bambuFilamentCatalog.flatMap(g => g.items);
    this._populateHandyFilaments();
    return items.length;
  }

  // Distinct filament types present in the merged catalog, in a sensible
  // fixed order first (matching common Bambu Studio ordering) with anything
  // unrecognized appended alphabetically after.
  _getFilamentTypeList() {
    const preferredOrder = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PA-CF', 'PVA', 'HIPS'];
    const present = new Set(this._flatFilamentCatalog.map(f => (f.type || 'PLA').toUpperCase()));
    const ordered = preferredOrder.filter(t => present.has(t));
    const extra = [...present].filter(t => !preferredOrder.includes(t)).sort();
    const result = [...ordered, ...extra];
    return result.length ? result : ['PLA'];
  }

  _populateHandyFilaments() {
    const typeSel = this.shadowRoot.getElementById('modal-type-select');
    let matSel = this.shadowRoot.getElementById('modal-mat-select');
    if (!typeSel || !matSel) return;

    // Rebuilding innerHTML on every modal open left the *element* itself
    // untouched, so 'change' listeners attached below stacked up a fresh
    // duplicate each time the modal was opened — cloning (rather than
    // reusing) the nodes drops any previously-bound listeners first.
    const freshType = typeSel.cloneNode(false);
    typeSel.replaceWith(freshType);
    const freshMat = matSel.cloneNode(false);
    matSel.replaceWith(freshMat);

    const hint = this.shadowRoot.getElementById('modal-ams-hint');
    const colInput = this.shadowRoot.getElementById('modal-color-select');
    const colHexLabel = this.shadowRoot.getElementById('modal-color-hex-label');
    const metaMin = this.shadowRoot.getElementById('modal-meta-tempmin');
    const metaMax = this.shadowRoot.getElementById('modal-meta-tempmax');

    // Filament dropdown is always populated from ONLY the items matching
    // the currently selected type — this is what actually fixes "picking a
    // different type doesn't change what gets applied": previously there
    // was a single flat list mixing every type together, and the option
    // the code ended up reading back at apply-time could be out of step
    // with what looked selected. With a real cascade, the Filament list
    // can never contain an item of the wrong type in the first place.
    const populateMatOptions = (type) => {
      const items = this._flatFilamentCatalog.filter(f => (f.type || 'PLA').toUpperCase() === type.toUpperCase());
      freshMat.innerHTML = items.map(p => `<option value="${p.name}" data-color="${p.color}" data-ams="${p.ams}" data-idx="${p.idx || ''}" data-type="${p.type || 'PLA'}" data-tempmin="${p.tempMin}" data-tempmax="${p.tempMax}">${p.name}${p.ams ? '' : ' (external spool)'}</option>`).join('');
    };

    const updateFromMatSelection = () => {
      const opt = freshMat.options[freshMat.selectedIndex];
      const col = opt?.getAttribute('data-color');
      const isAms = opt?.getAttribute('data-ams') === 'true';
      const tempMin = opt?.getAttribute('data-tempmin');
      const tempMax = opt?.getAttribute('data-tempmax');
      if (col && colInput) { colInput.value = col; if (colHexLabel) colHexLabel.textContent = col.toUpperCase(); }
      if (metaMin) metaMin.textContent = `${tempMin || 190}°C`;
      if (metaMax) metaMax.textContent = `${tempMax || 230}°C`;
      if (hint) {
        if (this._selectedTrayIndex !== null && this._selectedTrayIndex < 4 && !isAms) {
          hint.className = 'ams-hint warn';
          hint.textContent = '⚠ This material is not recommended for AMS feeding — consider the external spool holder instead.';
        } else {
          hint.className = 'ams-hint';
          hint.textContent = isAms ? '✓ AMS compatible' : 'External spool holder recommended';
        }
      }
    };

    const typeList = this._getFilamentTypeList();
    freshType.innerHTML = typeList.map(t => `<option value="${t}">${t}</option>`).join('');
    populateMatOptions(typeList[0]);

    freshType.addEventListener('change', () => {
      populateMatOptions(freshType.value);
      updateFromMatSelection();
    });
    freshMat.addEventListener('change', updateFromMatSelection);
    colInput?.addEventListener('input', () => { if (colHexLabel) colHexLabel.textContent = colInput.value.toUpperCase(); });

    setTimeout(updateFromMatSelection, 0);
  }

  // Preselect the type + filament that match the current slot's material
  // name (if any), and set the color swatch to the slot's actual current
  // color instead of defaulting to green.
  //
  // Fix: the previous version matched using `optName.includes(needle) ||
  // needle.includes(optName)` against the ENTIRE flat catalog. For a
  // generic/short current-material string (many printers just report the
  // bare family, e.g. "PLA") that substring test matches almost every
  // option in that family, and the loop always stopped at whichever one
  // happened to be first in the list — "Bambu PLA Basic" is first — so
  // syncing "Bambu PLA Galaxy" and then reopening the slot could visibly
  // "revert" to Basic even though the actual sync had gone through fine.
  // This version only trusts a substring match when the reported name is
  // specific enough to be meaningful, and otherwise just picks the right
  // TYPE and leaves the specific filament on that type's default (usually
  // "Basic") rather than guessing a wrong specific match.
  _preselectCurrentFilament(materialName, colorHex) {
    const typeSel = this.shadowRoot.getElementById('modal-type-select');
    const matSel = this.shadowRoot.getElementById('modal-mat-select');
    const colInput = this.shadowRoot.getElementById('modal-color-select');
    const colHexLabel = this.shadowRoot.getElementById('modal-color-hex-label');
    if (!typeSel || !matSel) return;

    const typeList = this._getFilamentTypeList();
    let matchedItem = null;

    if (materialName) {
      const needle = materialName.toLowerCase().trim();
      // A specific match needs the reported name to carry more than just
      // the bare material family (so "PLA" alone never "matches" every
      // PLA entry — only something like "PLA Galaxy" or "Galaxy" does).
      const isSpecificEnough = needle.length > 4 && !typeList.some(t => t.toLowerCase() === needle);
      if (isSpecificEnough) {
        matchedItem = this._flatFilamentCatalog.find(f => {
          const optName = f.name.toLowerCase();
          return needle === optName || needle.includes(optName) || optName.includes(needle);
        }) || null;
      }
      if (!matchedItem) {
        // Fall back to matching just the type, so at least the correct
        // material family is selected instead of leaving it on PLA.
        const typeGuess = typeList.find(t => needle.includes(t.toLowerCase()) || t.toLowerCase().includes(needle));
        if (typeGuess) typeSel.value = typeGuess;
      }
    }

    if (matchedItem) typeSel.value = (matchedItem.type || 'PLA').toUpperCase();
    if (!typeList.includes(typeSel.value)) typeSel.value = typeList[0];

    // Rebuild the Filament list for whichever type ended up selected, then
    // select the matched item within it (if any).
    typeSel.dispatchEvent(new Event('change'));
    if (matchedItem) matSel.value = matchedItem.name;

    if (colorHex && colInput) {
      const normalized = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;
      if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
        colInput.value = normalized;
        if (colHexLabel) colHexLabel.textContent = normalized.toUpperCase();
      }
    }
    matSel.dispatchEvent(new Event('change'));
  }

  // Render Load / Unload / Reload buttons in the AMS modal, but only if the
  // Bambu integration actually exposes matching services in this HA instance.
  _renderAmsSlotActions() {
    const container = this.shadowRoot.getElementById('ams-modal-actions');
    if (!container) return;
    const services = this._hass?.services?.['bambu_lab'] || {};
    const deviceId = this._config.device_id;
    const tray = this._selectedTrayIndex;

    const actions = [];
    if (services['load_filament'] || services['ams_load']) {
      actions.push({ label: 'Load', service: services['load_filament'] ? 'load_filament' : 'ams_load' });
    }
    if (services['unload_filament'] || services['ams_unload']) {
      actions.push({ label: 'Unload', service: services['unload_filament'] ? 'unload_filament' : 'ams_unload' });
    }
    if (services['rfid_reload'] || services['ams_reload'] || services['rfid_scan']) {
      actions.push({ label: 'Reload / RFID', service: services['rfid_reload'] ? 'rfid_reload' : (services['ams_reload'] ? 'ams_reload' : 'rfid_scan') });
    }

    if (actions.length === 0) {
      container.innerHTML = `<div class="ams-hint" style="grid-column: 1 / -1;">Load/Unload/Reload services were not found on this Home Assistant instance for the Bambu integration.</div>`;
      return;
    }

    container.innerHTML = actions.map(a => `<button class="btn" data-ams-action="${a.service}">${a.label}</button>`).join('');
    container.querySelectorAll('[data-ams-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const service = btn.getAttribute('data-ams-action');
        this._callService('bambu_lab', service, { device_id: deviceId, tray: tray, ams_id: 0, tray_id: tray });
      });
    });
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================
  _bindAllInteractions() {
    const tabBtns = this.shadowRoot.querySelectorAll('.tab-btn');
    const tabPanes = this.shadowRoot.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;

        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        this._activeTab = targetTab;
        if (targetTab !== 'home') this._undockHomeDetail();

        const targetPane = this.shadowRoot.getElementById(`pane-${targetTab}`);
        if (targetPane) {
          targetPane.classList.add('active');
        }
        this._scheduleFit();
      });
    });

    const selPageSize = this.shadowRoot.getElementById('sel-page-size');
    const btnPagePrev = this.shadowRoot.getElementById('btn-page-prev');
    const btnPageNext = this.shadowRoot.getElementById('btn-page-next');

    if (selPageSize) {
      selPageSize.addEventListener('change', (e) => {
        this._pageSize = parseInt(e.target.value, 10);
        this._currentPage = 1;
        this._updatePrintHistoryList();
      });
    }
    if (btnPagePrev) {
      btnPagePrev.addEventListener('click', () => {
        if (this._currentPage > 1) { this._currentPage--; this._updatePrintHistoryList(); }
      });
    }
    if (btnPageNext) {
      btnPageNext.addEventListener('click', () => { this._currentPage++; this._updatePrintHistoryList(); });
    }

    const btnSortDate = this.shadowRoot.getElementById('btn-sort-date');
    if (btnSortDate) {
      btnSortDate.addEventListener('click', () => {
        const next = btnSortDate.getAttribute('data-dir') === 'desc' ? 'asc' : 'desc';
        btnSortDate.setAttribute('data-dir', next);
        btnSortDate.title = next === 'desc' ? 'Sort by created date: newest first' : 'Sort by created date: oldest first';
        this._historySortDir = next;
        this._currentPage = 1;
        this._updatePrintHistoryList();
      });
    }

    const powerBtn = this.shadowRoot.getElementById('btn-power-socket');
    if (powerBtn) {
      powerBtn.addEventListener('click', () => {
        if (confirm('Toggle printer main power socket state?')) {
          this._callService('switch', 'toggle', { entity_id: this._config.power_switch_entity });
        }
      });
    }

    const toggleLight = this.shadowRoot.getElementById('btn-toggle-light');
    const toggleCam = this.shadowRoot.getElementById('btn-toggle-cam');
    if (toggleLight) toggleLight.addEventListener('click', () => this._callService('light', 'toggle', { entity_id: this._config.light_entity }));
    if (toggleCam) toggleCam.addEventListener('click', () => this._callService('switch', 'toggle', { entity_id: this._config.camera_switch_entity }));

    // Full state refresh — presses the printer's "Full state refresh" /
    // "Force refresh" button entity from the Bambu integration (a `button`
    // domain entity, same shape as pause/resume/stop below). Spins the icon
    // briefly so a tap gets visible feedback even though the entity itself
    // has no readable state to reflect back.
    const btnFullRefresh = this.shadowRoot.getElementById('btn-full-refresh');
    if (btnFullRefresh) {
      btnFullRefresh.addEventListener('click', () => {
        if (!this._config.full_refresh_entity) return;
        this._callService('button', 'press', { entity_id: this._config.full_refresh_entity });
        btnFullRefresh.classList.add('spin-once');
        setTimeout(() => btnFullRefresh.classList.remove('spin-once'), 650);
      });
    }

    const btnPause = this.shadowRoot.getElementById('btn-pause-job');
    const btnResume = this.shadowRoot.getElementById('btn-resume-job');
    const btnStop = this.shadowRoot.getElementById('btn-stop-job');

    if (btnPause) btnPause.addEventListener('click', () => this._callService('button', 'press', { entity_id: this._config.pause_entity }));
    if (btnResume) btnResume.addEventListener('click', () => this._callService('button', 'press', { entity_id: this._config.resume_entity }));
    if (btnStop) {
      btnStop.addEventListener('click', () => {
        if (confirm('Abort active print project execution?')) {
          this._callService('button', 'press', { entity_id: this._config.stop_entity });
        }
      });
    }

    const setNozzle0 = this.shadowRoot.getElementById('set-nozzle-0');
    const setNozzle210 = this.shadowRoot.getElementById('set-nozzle-210');
    const setNozzle250 = this.shadowRoot.getElementById('set-nozzle-250');
    if (setNozzle0) setNozzle0.addEventListener('click', () => this._callService('number', 'set_value', { entity_id: this._config.nozzle_target_entity, value: 0 }));
    if (setNozzle210) setNozzle210.addEventListener('click', () => this._callService('number', 'set_value', { entity_id: this._config.nozzle_target_entity, value: 210 }));
    if (setNozzle250) setNozzle250.addEventListener('click', () => this._callService('number', 'set_value', { entity_id: this._config.nozzle_target_entity, value: 250 }));

    const setBed0 = this.shadowRoot.getElementById('set-bed-0');
    const setBed55 = this.shadowRoot.getElementById('set-bed-55');
    const setBed80 = this.shadowRoot.getElementById('set-bed-80');
    if (setBed0) setBed0.addEventListener('click', () => this._callService('number', 'set_value', { entity_id: this._config.bed_target_entity, value: 0 }));
    if (setBed55) setBed55.addEventListener('click', () => this._callService('number', 'set_value', { entity_id: this._config.bed_target_entity, value: 55 }));
    if (setBed80) setBed80.addEventListener('click', () => this._callService('number', 'set_value', { entity_id: this._config.bed_target_entity, value: 80 }));

    const spSilent = this.shadowRoot.getElementById('sp-silent');
    const spStandard = this.shadowRoot.getElementById('sp-standard');
    const spSport = this.shadowRoot.getElementById('sp-sport');
    const spLudicrous = this.shadowRoot.getElementById('sp-ludicrous');
    if (spSilent) spSilent.addEventListener('click', () => this._callService('select', 'select_option', { entity_id: this._config.speed_profile_entity, option: 'silent' }));
    if (spStandard) spStandard.addEventListener('click', () => this._callService('select', 'select_option', { entity_id: this._config.speed_profile_entity, option: 'standard' }));
    if (spSport) spSport.addEventListener('click', () => this._callService('select', 'select_option', { entity_id: this._config.speed_profile_entity, option: 'sport' }));
    if (spLudicrous) spLudicrous.addEventListener('click', () => this._callService('select', 'select_option', { entity_id: this._config.speed_profile_entity, option: 'ludicrous' }));

    const jog01 = this.shadowRoot.getElementById('jog-step-01');
    const jog1 = this.shadowRoot.getElementById('jog-step-1');
    const jog10 = this.shadowRoot.getElementById('jog-step-10');
    const jog50 = this.shadowRoot.getElementById('jog-step-50');
    if (jog01) jog01.addEventListener('click', () => { this._jogStep = 0.1; });
    if (jog1) jog1.addEventListener('click', () => { this._jogStep = 1; });
    if (jog10) jog10.addEventListener('click', () => { this._jogStep = 10; });
    if (jog50) jog50.addEventListener('click', () => { this._jogStep = 50; });

    const jogXp = this.shadowRoot.getElementById('btn-jog-xp');
    const jogXm = this.shadowRoot.getElementById('btn-jog-xm');
    const jogYp = this.shadowRoot.getElementById('btn-jog-yp');
    const jogYm = this.shadowRoot.getElementById('btn-jog-ym');
    const jogZp = this.shadowRoot.getElementById('btn-jog-zp');
    const jogZm = this.shadowRoot.getElementById('btn-jog-zm');
    const jogHome = this.shadowRoot.getElementById('btn-jog-home');
    if (jogXp) jogXp.addEventListener('click', () => this._moveAxis('X', this._jogStep));
    if (jogXm) jogXm.addEventListener('click', () => this._moveAxis('X', -this._jogStep));
    if (jogYp) jogYp.addEventListener('click', () => this._moveAxis('Y', this._jogStep));
    if (jogYm) jogYm.addEventListener('click', () => this._moveAxis('Y', -this._jogStep));
    if (jogZp) jogZp.addEventListener('click', () => this._moveAxis('Z', -this._jogStep));
    if (jogZm) jogZm.addEventListener('click', () => this._moveAxis('Z', this._jogStep));
    if (jogHome) jogHome.addEventListener('click', () => this._moveAxis('HOME', 0));

    const ext10 = this.shadowRoot.getElementById('btn-extrude-10');
    const ret10 = this.shadowRoot.getElementById('btn-retract-10');
    if (ext10) ext10.addEventListener('click', () => this._extrudeRetract('extrude'));
    if (ret10) ret10.addEventListener('click', () => this._extrudeRetract('retract'));

    const refreshHistoryBtn = this.shadowRoot.getElementById('btn-refresh-history');
    if (refreshHistoryBtn) refreshHistoryBtn.addEventListener('click', () => this._updatePrintHistoryList());

    const reprintModal = this.shadowRoot.getElementById('reprint-modal');
    const cancelReprintBtn = this.shadowRoot.getElementById('btn-reprint-modal-cancel');
    const confirmReprintBtn = this.shadowRoot.getElementById('btn-reprint-modal-confirm');
    if (cancelReprintBtn) cancelReprintBtn.addEventListener('click', () => reprintModal?.classList.remove('open'));
    if (confirmReprintBtn) {
      confirmReprintBtn.addEventListener('click', () => {
        this._executeHandyStyleReprint();
        reprintModal?.classList.remove('open');
      });
    }

    const addMappingBtn = this.shadowRoot.getElementById('btn-reprint-add-mapping');
    if (addMappingBtn) addMappingBtn.addEventListener('click', () => this._addReprintMappingRow());

    // ---------------- TEMPERATURE EDIT MODAL ----------------
    const tempModal = this.shadowRoot.getElementById('temp-modal');
    const tempRange = this.shadowRoot.getElementById('temp-modal-range');
    const tempValueLbl = this.shadowRoot.getElementById('temp-modal-value');
    const tempTitle = this.shadowRoot.getElementById('temp-modal-title');
    const tempPresets = this.shadowRoot.getElementById('temp-modal-presets');
    const btnTempCancel = this.shadowRoot.getElementById('btn-temp-modal-cancel');
    const btnTempApply = this.shadowRoot.getElementById('btn-temp-modal-apply');
    this._tempModalTarget = null; // 'nozzle' | 'bed'

    const openTempModal = (kind) => {
      this._tempModalTarget = kind;
      const isNozzle = kind === 'nozzle';
      const targetEntity = isNozzle ? this._config.nozzle_target_entity : this._config.bed_target_entity;
      const currentTarget = parseFloat(this._hass?.states[targetEntity]?.state) || 0;
      const max = isNozzle ? 320 : 120;
      tempRange.max = String(max);
      tempRange.value = String(currentTarget);
      tempValueLbl.textContent = currentTarget;
      tempTitle.textContent = isNozzle ? 'Set Nozzle Target Temperature' : 'Set Heatbed Target Temperature';
      const presets = isNozzle ? [0, 190, 210, 220, 230, 250, 260] : [0, 55, 60, 65, 80, 100];
      tempPresets.innerHTML = presets.map(p => `<button class="btn" data-temp-preset="${p}">${p}°C</button>`).join('');
      tempPresets.querySelectorAll('[data-temp-preset]').forEach(b => {
        b.addEventListener('click', () => {
          const v = b.getAttribute('data-temp-preset');
          tempRange.value = v;
          tempValueLbl.textContent = v;
        });
      });
      tempModal.classList.add('open');
    };

    if (tempRange) tempRange.addEventListener('input', () => { tempValueLbl.textContent = tempRange.value; });
    if (btnTempCancel) btnTempCancel.addEventListener('click', () => tempModal.classList.remove('open'));
    if (btnTempApply) {
      btnTempApply.addEventListener('click', () => {
        const isNozzle = this._tempModalTarget === 'nozzle';
        const targetEntity = isNozzle ? this._config.nozzle_target_entity : this._config.bed_target_entity;
        this._callService('number', 'set_value', { entity_id: targetEntity, value: parseFloat(tempRange.value) });
        tempModal.classList.remove('open');
      });
    }

    this.shadowRoot.querySelectorAll('[data-edit-temp]').forEach(row => {
      row.addEventListener('click', () => openTempModal(row.getAttribute('data-edit-temp')));
    });

    // ---------------- FAN SPEED EDIT MODAL ----------------
    const fanModal = this.shadowRoot.getElementById('fan-modal');
    const fanRange = this.shadowRoot.getElementById('fan-modal-range');
    const fanValueLbl = this.shadowRoot.getElementById('fan-modal-value');
    const fanTitle = this.shadowRoot.getElementById('fan-modal-title');
    const btnFanCancel = this.shadowRoot.getElementById('btn-fan-modal-cancel');
    const btnFanApply = this.shadowRoot.getElementById('btn-fan-modal-apply');
    this._fanModalEntityKey = null;

    const openFanModal = (entityKey, label) => {
      this._fanModalEntityKey = entityKey;
      const entityId = this._config[entityKey];
      const stateObj = this._hass?.states[entityId];
      const currentPct = stateObj?.attributes?.percentage ?? (stateObj?.state === 'on' ? 100 : 0);
      fanRange.value = String(currentPct);
      fanValueLbl.textContent = currentPct;
      fanTitle.textContent = `Set ${label} Speed`;
      fanModal.classList.add('open');
    };

    if (fanRange) fanRange.addEventListener('input', () => { fanValueLbl.textContent = fanRange.value; });
    fanModal?.querySelectorAll('[data-fan-preset]').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.getAttribute('data-fan-preset');
        fanRange.value = v;
        fanValueLbl.textContent = v;
      });
    });
    if (btnFanCancel) btnFanCancel.addEventListener('click', () => fanModal.classList.remove('open'));
    if (btnFanApply) {
      btnFanApply.addEventListener('click', () => {
        const entityId = this._config[this._fanModalEntityKey];
        const pct = parseInt(fanRange.value, 10);
        if (pct <= 0) {
          this._callService('fan', 'turn_off', { entity_id: entityId });
        } else {
          this._callService('fan', 'set_percentage', { entity_id: entityId, percentage: pct });
        }
        fanModal.classList.remove('open');
      });
    }

    this.shadowRoot.querySelectorAll('[data-edit-fan]').forEach(box => {
      box.addEventListener('click', () => openFanModal(box.getAttribute('data-edit-fan'), box.getAttribute('data-fan-label') || 'Fan'));
    });

    // ---------------- AMS FILAMENT MODAL ----------------
    for (let i = 0; i < 4; i++) {
      const slot = this.shadowRoot.getElementById(`ams-slot-${i}`);
      if (slot) slot.addEventListener('click', () => this._openTrayFilamentModal(i));
      const homeSwatch = this.shadowRoot.getElementById(`home-ams-swatch-${i}`);
      if (homeSwatch) {
        homeSwatch.addEventListener('click', () => {
          this._openTrayFilamentModal(i);
          this._dockHomeDetail('Filament / AMS Sync', 'ams-modal');
        });
      }
    }

    const extSlot = this.shadowRoot.getElementById('ext-spool-slot');
    if (extSlot) extSlot.addEventListener('click', () => this._openExternalSpoolModal());

    const modal = this.shadowRoot.getElementById('ams-modal');
    const modalCancel = this.shadowRoot.getElementById('btn-modal-cancel');
    const modalApply = this.shadowRoot.getElementById('btn-modal-apply');
    if (modalCancel) modalCancel.addEventListener('click', () => { modal?.classList.remove('open'); this._undockHomeDetail(); });
    if (modalApply) {
      modalApply.addEventListener('click', () => {
        const typeSel = this.shadowRoot.getElementById('modal-type-select');
        const sel = this.shadowRoot.getElementById('modal-mat-select');
        const opt = sel?.options[sel.selectedIndex];
        const mat = opt?.value;
        const trayType = typeSel?.value || opt?.getAttribute('data-type') || 'PLA';
        let trayInfoIdx = opt?.getAttribute('data-idx') || '';
        const tempMin = parseInt(opt?.getAttribute('data-tempmin'), 10) || 190;
        const tempMax = parseInt(opt?.getAttribute('data-tempmax'), 10) || 230;
        const col = this.shadowRoot.getElementById('modal-color-select')?.value || '#00AE42';
        const trayColor = `${col.replace('#', '').toUpperCase()}FF`;
        let idxWasBackfilled = false;

        if (!trayInfoIdx) {
          // No usable id came back with this profile (typically a filament
          // pulled live off the printer via get_filament_data whose id field
          // didn't parse, or a brand/entry with no official Bambu SKU).
          // `bambu_lab.set_filament` has no separate brand/name field —
          // tray_info_idx IS the only thing the printer's firmware uses to
          // look up what to display, so an empty id blanks the type instead
          // of trusting tray_type. We have to borrow *some* real id, but
          // previously this always grabbed a Bambu "...Basic" id — which
          // silently rewrote every custom/third-party brand to "Basic" on
          // the printer's display, even though tray_type/color were correct.
          // Prefer the neutral "Generic <type>" id instead (honest: this is
          // an unbranded/unrecognized spool, not specifically Bambu Basic),
          // only falling back to Basic if no Generic entry exists for the type.
          const fallback = this._flatFilamentCatalog.find(f => f.idx && f.type?.toUpperCase() === trayType.toUpperCase() && f.name.toLowerCase().includes('generic'))
            || this._flatFilamentCatalog.find(f => f.idx && f.type?.toUpperCase() === trayType.toUpperCase() && f.name.toLowerCase().includes('basic'))
            || this._flatFilamentCatalog.find(f => f.idx && f.type?.toUpperCase() === trayType.toUpperCase());
          if (fallback?.idx) {
            trayInfoIdx = fallback.idx;
            idxWasBackfilled = true;
          }
        }

        let targetEntity = null;
        if (this._selectedTrayIndex !== null && this._selectedTrayIndex < 4) {
          targetEntity = this._config.ams_trays?.[this._selectedTrayIndex];
        } else if (this._selectedTrayIndex === 254) {
          targetEntity = this._config.external_spool_entity;
        }

        const hintEl = this.shadowRoot.getElementById('modal-ams-hint');

        // A missing target entity is a visible error instead of a silent
        // no-op. A missing tray_info_idx no longer results in an empty
        // string being sent either — see the backfill above — since an
        // empty idx is what caused the printer to accept the color but
        // blank the filament type.
        if (!targetEntity) {
          if (hintEl) {
            hintEl.className = 'ams-hint warn';
            hintEl.textContent = '⚠ No AMS tray / external spool entity is configured for this slot (check ams_trays / external_spool_entity in the card config) — nothing was sent to the printer.';
          }
          return;
        }
        if (idxWasBackfilled && hintEl) {
          hintEl.className = 'ams-hint warn';
          hintEl.textContent = `⚠ No official Bambu profile id exists for this filament, so the printer will display it as a generic ${trayType} (color and temps are still sent correctly) — the printer's own AMS/tray display can only show names it recognizes from its internal id catalog.`;
        }

        this._syncFilamentToPrinter(targetEntity, {
          tray_info_idx: trayInfoIdx,
          tray_color: trayColor,
          tray_type: trayType,
          nozzle_temp_min: tempMin,
          nozzle_temp_max: tempMax
        });

        // Optimistic local repaint so the UI doesn't look stuck until the
        // next state update comes back from the printer.
        if (this._selectedTrayIndex !== null && this._selectedTrayIndex < 4) {
          const matLbl = this.shadowRoot.getElementById(`spool-mat-${this._selectedTrayIndex}`);
          const colRing = this.shadowRoot.getElementById(`spool-color-${this._selectedTrayIndex}`);
          const homeSwatch = this.shadowRoot.getElementById(`home-ams-swatch-${this._selectedTrayIndex}`);
          if (matLbl && mat) matLbl.textContent = mat;
          if (colRing && col) colRing.style.borderColor = col;
          if (homeSwatch && col) homeSwatch.style.background = col;
        } else if (this._selectedTrayIndex === 254) {
          const matLbl = this.shadowRoot.getElementById('ext-spool-mat');
          const colRing = this.shadowRoot.getElementById('ext-spool-color');
          if (matLbl && mat) matLbl.textContent = mat;
          if (colRing && col) colRing.style.borderColor = col;
        }
        modal?.classList.remove('open');
        this._undockHomeDetail();
      });
    }

    // ---------------- HOME TAB: extra icon controls ----------------
    const btnOpenFiles = this.shadowRoot.getElementById('btn-open-files');
    if (btnOpenFiles) {
      btnOpenFiles.addEventListener('click', () => {
        this.shadowRoot.querySelector('.tab-btn[data-tab="history"]')?.click();
      });
    }

    const btnOpenMove = this.shadowRoot.getElementById('btn-open-move');
    if (btnOpenMove) {
      btnOpenMove.addEventListener('click', () => {
        this._dockHomeDetail('Move Head / Bed', 'pane-movement');
      });
    }

    const btnHomeDetailClose = this.shadowRoot.getElementById('btn-home-detail-close');
    if (btnHomeDetailClose) btnHomeDetailClose.addEventListener('click', () => this._undockHomeDetail());

    // ---------------- SKIP OBJECTS MODAL ----------------
    const btnOpenSkip = this.shadowRoot.getElementById('btn-open-skip');
    if (btnOpenSkip) {
      btnOpenSkip.addEventListener('click', () => {
        this._openSkipObjectsModal();
        this._dockHomeDetail('Skip Objects', 'skip-objects-modal');
      });
    }

    const skipModal = this.shadowRoot.getElementById('skip-objects-modal');
    const btnSkipClose = this.shadowRoot.getElementById('btn-skip-modal-close');
    const btnSkipCancel = this.shadowRoot.getElementById('btn-skip-modal-cancel');
    const btnSkipConfirm = this.shadowRoot.getElementById('btn-skip-modal-confirm');
    if (btnSkipClose) btnSkipClose.addEventListener('click', () => this._closeSkipObjectsModal());
    if (btnSkipCancel) btnSkipCancel.addEventListener('click', () => this._closeSkipObjectsModal());
    if (btnSkipConfirm) btnSkipConfirm.addEventListener('click', () => this._confirmSkipObjects());
    if (skipModal) {
      skipModal.addEventListener('click', (e) => {
        if (e.target === skipModal) this._closeSkipObjectsModal();
      });
    }
    const skipCanvas = this.shadowRoot.getElementById('skip-canvas');
    if (skipCanvas) skipCanvas.addEventListener('click', (e) => this._onSkipCanvasClick(e));

    // ---------------- HOME TAB: custom speed combobox ----------------
    const speedCombo = this.shadowRoot.getElementById('home-speed-combo');
    const speedTrigger = this.shadowRoot.getElementById('home-speed-trigger');
    const speedLabel = this.shadowRoot.getElementById('home-speed-label');
    if (speedTrigger) {
      speedTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        speedCombo?.classList.toggle('open');
      });
    }
    this.shadowRoot.querySelectorAll('#home-speed-list [data-speed]').forEach(opt => {
      opt.addEventListener('click', () => {
        const option = opt.getAttribute('data-speed');
        this._callService('select', 'select_option', { entity_id: this._config.speed_profile_entity, option });
        if (speedLabel) speedLabel.textContent = opt.textContent;
        speedCombo?.classList.remove('open');
      });
    });
    document.addEventListener('click', () => speedCombo?.classList.remove('open'));

    this._bindDeveloperTab();
  }

  // Open the AMS/spool filament-sync modal for a given tray index (0-3),
  // shared by the AMS matrix tab and the Home tab's compact swatch row.
  _openTrayFilamentModal(i) {
    this._selectedTrayIndex = i;
    this._populateHandyFilaments();
    const modal = this.shadowRoot.getElementById('ams-modal');
    const amsModalTitle = this.shadowRoot.getElementById('ams-modal-title');
    const trayEntity = this._config.ams_trays?.[i];
    const stateObj = trayEntity ? this._hass?.states[trayEntity] : null;
    const currentMat = stateObj?.attributes?.subty || stateObj?.attributes?.tray_type || stateObj?.attributes?.material || stateObj?.state || '';
    const currentColor = stateObj?.attributes?.color || stateObj?.attributes?.cols?.[0] || '';
    if (amsModalTitle) amsModalTitle.textContent = `AMS Slot ${i + 1} — Filament Sync`;
    this._preselectCurrentFilament(currentMat, currentColor);
    this._renderAmsSlotActions();
    if (modal) modal.classList.add('open');
  }

  _openExternalSpoolModal() {
    this._selectedTrayIndex = 254;
    this._populateHandyFilaments();
    const modal = this.shadowRoot.getElementById('ams-modal');
    const amsModalTitle = this.shadowRoot.getElementById('ams-modal-title');
    const stateObj = this._hass?.states[this._config.external_spool_entity];
    const currentMat = stateObj?.attributes?.subty || stateObj?.attributes?.tray_type || stateObj?.state || '';
    const currentColor = stateObj?.attributes?.color || '';
    if (amsModalTitle) amsModalTitle.textContent = 'External Spool — Filament Sync';
    this._preselectCurrentFilament(currentMat, currentColor);
    this._renderAmsSlotActions();
    if (modal) modal.classList.add('open');
  }

  // The actual filament-sync fix: prefer the Bambu Lab integration's own
  // `set_filament` service (entity-targeted, per the integration's docs);
  // fall back to publishing the documented raw `ams_filament_setting` MQTT
  // command if that service isn't registered on this Home Assistant instance
  // (e.g. an older integration version).
  _syncFilamentToPrinter(entityId, data) {
    if (!this._hass || !entityId) return;
    const services = this._hass.services?.['bambu_lab'] || {};
    if (services['set_filament']) {
      this._callService('bambu_lab', 'set_filament', { entity_id: entityId, ...data });
      return;
    }
    const stateObj = this._hass.states[entityId];
    const amsId = stateObj?.attributes?.ams_id ?? 0;
    const trayId = stateObj?.attributes?.tray_id ?? (this._selectedTrayIndex === 254 ? 254 : this._selectedTrayIndex);
    const deviceId = this._config.device_id;
    const payload = {
      print: {
        sequence_id: "0",
        command: "ams_filament_setting",
        ams_id: amsId,
        tray_id: trayId,
        tray_info_idx: data.tray_info_idx,
        tray_color: data.tray_color,
        nozzle_temp_min: data.nozzle_temp_min,
        nozzle_temp_max: data.nozzle_temp_max,
        tray_type: data.tray_type,
        setting_id: ""
      }
    };
    this._hass.callService('mqtt', 'publish', { topic: `device/${deviceId}/request`, payload: JSON.stringify(payload) });
  }

  _callService(domain, service, data) {
    if (this._hass) {
      this._hass.callService(domain, service, data);
    }
  }

  // Jogging/homing goes through the integration's own `bambu_lab.move_axis`
  // service (device_id + axis "X"/"Y"/"Z"/"HOME" + distance) instead of a
  // raw MQTT publish. Raw `mqtt.publish` requires HA's core MQTT integration
  // to be set up with a broker, which ha-bambulab does NOT need for normal
  // operation — it keeps its own connection to the printer. Calling
  // mqtt.publish without that separate broker configured is exactly what
  // produced "Cannot publish to topic ..., make sure MQTT is set up
  // correctly." This mirrors what the official ha-bambulab-cards package
  // does for its own move controls.
  _moveAxis(axis, distance) {
    if (!this._hass) return;
    const deviceId = this._config.device_id;
    this._hass.callService('bambu_lab', 'move_axis', { device_id: deviceId, axis, distance })
      .catch((e) => console.error('move_axis failed:', e));
  }

  _extrudeRetract(type) {
    if (!this._hass) return;
    const deviceId = this._config.device_id;
    this._hass.callService('bambu_lab', 'extrude_retract', { device_id: deviceId, type })
      .catch((e) => console.error('extrude_retract failed:', e));
  }

  _publishGCode(gcode) {
    if (!this._hass) return;
    const deviceId = this._config.device_id;
    const mqttTopic = `device/${deviceId}/control`;
    const mqttPayload = { print: { sequence_id: "0", command: "gcode_line", param: gcode } };
    this._hass.callService('mqtt', 'publish', { topic: mqttTopic, payload: JSON.stringify(mqttPayload) });
  }

  // ==========================================================================
  // DEVELOPER TAB — extra bambu_lab actions available over MQTT that the rest
  // of the UI doesn't otherwise surface.
  // ==========================================================================
  _bindDeveloperTab() {
    const deviceId = this._config.device_id;

    const gcodeInput = this.shadowRoot.getElementById('dev-gcode-input');
    const sendGcode = this.shadowRoot.getElementById('dev-send-gcode');
    if (sendGcode) {
      sendGcode.addEventListener('click', () => {
        const cmd = gcodeInput?.value?.trim();
        if (!cmd) return;
        const services = this._hass?.services?.['bambu_lab'] || {};
        if (services['send_command']) {
          this._callService('bambu_lab', 'send_command', { device_id: deviceId, command: cmd });
        } else {
          this._publishGCode(cmd);
        }
      });
    }

    // G-code helper chips just fill the input (they don't auto-send) so you
    // can still glance at/edit the command before it goes to the printer.
    this.shadowRoot.querySelectorAll('#dev-gcode-helpers [data-gcode]').forEach(chip => {
      chip.addEventListener('click', () => {
        if (gcodeInput) gcodeInput.value = chip.getAttribute('data-gcode');
      });
    });

    const dryStart = this.shadowRoot.getElementById('dev-dry-start');
    const dryStop = this.shadowRoot.getElementById('dev-dry-stop');
    if (dryStart) {
      dryStart.addEventListener('click', () => {
        const temp = parseInt(this.shadowRoot.getElementById('dev-dry-temp')?.value, 10) || 55;
        const duration = parseInt(this.shadowRoot.getElementById('dev-dry-hours')?.value, 10) || 4;
        const rotateTray = this.shadowRoot.getElementById('dev-dry-rotate')?.checked ?? true;
        this._callService('bambu_lab', 'start_filament_drying', { device_id: deviceId, temp, rotate_tray: rotateTray, duration });
      });
    }
    if (dryStop) dryStop.addEventListener('click', () => this._callService('bambu_lab', 'stop_filament_drying', { device_id: deviceId }));

    const retryLoad = this.shadowRoot.getElementById('dev-retry-load');
    const doneLoad = this.shadowRoot.getElementById('dev-done-load');
    const readRfid = this.shadowRoot.getElementById('dev-read-rfid');
    if (retryLoad) retryLoad.addEventListener('click', () => this._callService('bambu_lab', 'retry_load_filament', { device_id: deviceId }));
    if (doneLoad) doneLoad.addEventListener('click', () => this._callService('bambu_lab', 'done_load_filament', { device_id: deviceId }));
    if (readRfid) {
      readRfid.addEventListener('click', () => {
        const idx = this._selectedTrayIndex !== null && this._selectedTrayIndex < 4 ? this._selectedTrayIndex : 0;
        const entityId = this._config.ams_trays?.[idx];
        if (entityId) this._callService('bambu_lab', 'read_rfid', { entity_id: entityId });
      });
    }

    const skipIds = this.shadowRoot.getElementById('dev-skip-ids');
    const skipSend = this.shadowRoot.getElementById('dev-skip-send');
    if (skipSend) {
      skipSend.addEventListener('click', () => {
        const objects = skipIds?.value?.trim();
        if (!objects) return;
        if (confirm(`Permanently skip objects: ${objects}? This cannot be undone for the current plate.`)) {
          this._callService('bambu_lab', 'skip_objects', { device_id: deviceId, objects });
          objects.split(',').map(s => s.trim()).filter(Boolean).forEach(id => this._skippedObjectIds.add(id));
          this._updateSkipObjectsGrid();
        }
      });
    }

    const getFilamentBtn = this.shadowRoot.getElementById('dev-get-filament-data');
    const filamentConsole = this.shadowRoot.getElementById('dev-console-filament');
    if (getFilamentBtn) {
      getFilamentBtn.addEventListener('click', async () => {
        if (filamentConsole) filamentConsole.textContent = 'Requesting…';
        try {
          const payload = await this._fetchFilamentDataFromPrinter();
          const mergedCount = this._applyFilamentDumpToCatalog(payload);
          if (filamentConsole) {
            filamentConsole.textContent = `Merged ${mergedCount} filament profile(s) from the printer into the AMS dropdown.\n\n` + JSON.stringify(payload, null, 2);
          }
        } catch (err) {
          if (filamentConsole) filamentConsole.textContent = err?.message || String(err);
        }
      });
    }

    const mqttPayloadInput = this.shadowRoot.getElementById('dev-mqtt-payload');
    const mqttSend = this.shadowRoot.getElementById('dev-mqtt-send');

    // MQTT helper chips fill the textarea with the *inner* command object —
    // the send button below still does the `{"print": ...}` wrap + sequence_id.
    this.shadowRoot.querySelectorAll('#dev-mqtt-helpers [data-mqtt]').forEach(chip => {
      chip.addEventListener('click', () => {
        if (mqttPayloadInput) mqttPayloadInput.value = chip.getAttribute('data-mqtt');
      });
    });

    if (mqttSend) {
      mqttSend.addEventListener('click', () => {
        if (!this._hass) return;
        let inner;
        try {
          inner = JSON.parse(mqttPayloadInput?.value || '{}');
        } catch (err) {
          alert('Payload is not valid JSON.');
          return;
        }
        if (!inner.sequence_id) inner.sequence_id = "0";
        const payload = { print: inner };
        this._hass.callService('mqtt', 'publish', { topic: `device/${deviceId}/request`, payload: JSON.stringify(payload) });
      });
    }

    // `pushall` lives under the `pushing` module, not `print`, so it gets its
    // own button rather than living in the generic print-command console.
    const mqttPushall = this.shadowRoot.getElementById('dev-mqtt-pushall');
    if (mqttPushall) {
      mqttPushall.addEventListener('click', () => {
        if (!this._hass) return;
        const payload = { pushing: { sequence_id: "0", command: "pushall" } };
        this._hass.callService('mqtt', 'publish', { topic: `device/${deviceId}/request`, payload: JSON.stringify(payload) });
      });
    }

    this._updateSkipObjectsGrid();
  }

  // Renders the current plate's objects (from printable_objects_entity's
  // `objects` attribute, e.g. {"320": "Baby Turtle.stl", ...}) as tappable
  // tiles. Tapping a tile immediately calls bambu_lab.skip_objects for that
  // one object and flips the tile to a disabled "Skipped" state — the
  // printer has no "un-skip" action, so this mirrors what's actually
  // possible rather than pretending it's a reversible toggle.
  // Auto-discovers a bambu_lab entity by its internal translation_key
  // (e.g. "printable_objects", "skipped_objects", "pick_image") instead of
  // requiring the user to hunt down and type an entity_id — this is exactly
  // how the official ha-bambulab-cards Print Control Card does it, which is
  // why that card never asks you to configure those entities either. The
  // translation_key is a fixed internal name and doesn't change even if
  // your entity_ids are localized (e.g. Polish-slugged).
  _resolveBambuEntity(translationKey) {
    const registry = this._hass?.entities;
    const deviceId = this._config.device_id;

    if (registry) {
      // Prefer an exact match scoped to this printer's device_id, same as
      // the official card — avoids grabbing another Bambu printer's entity
      // when more than one is set up in this Home Assistant instance.
      for (const entityId in registry) {
        const entry = registry[entityId];
        if (entry?.platform === 'bambu_lab' && entry?.translation_key === translationKey && (!deviceId || entry?.device_id === deviceId)) {
          return entityId;
        }
      }
      // Fall back to any bambu_lab entity with that translation_key if the
      // device_id didn't match (e.g. device_id not configured on the card).
      for (const entityId in registry) {
        const entry = registry[entityId];
        if (entry?.platform === 'bambu_lab' && entry?.translation_key === translationKey) {
          return entityId;
        }
      }
    }

    // Last-resort fallback for HA versions/setups where hass.entities isn't
    // populated or doesn't carry translation_key: match by entity_id suffix
    // against every known state, since ha-bambulab entity_ids always end in
    // `_<translation_key>` (e.g. sensor.p1s_printable_objects).
    const states = this._hass?.states;
    if (states) {
      const suffix = `_${translationKey}`;
      const found = Object.keys(states).find(id => id.endsWith(suffix));
      if (found) return found;
    }
    return null;
  }

  _updateSkipObjectsGrid() {
    const grid = this.shadowRoot.getElementById('dev-skip-objects-grid');
    if (!grid) return;

    const entityId = this._config.printable_objects_entity || this._resolveBambuEntity('printable_objects');
    const stateObj = entityId ? this._hass?.states[entityId] : null;
    const objects = stateObj?.attributes?.objects;
    const deviceId = this._config.device_id;

    if (!objects || typeof objects !== 'object' || Object.keys(objects).length === 0) {
      grid.innerHTML = `<div class="dev-hint" id="dev-skip-objects-empty">No <code>printable_objects</code> entity found for this printer yet (or no objects reported right now) — falling back to manual entry below.</div>`;
      return;
    }

    grid.innerHTML = Object.entries(objects).map(([id, name]) => {
      const skipped = this._skippedObjectIds.has(String(id));
      return `
        <div class="skip-object-tile${skipped ? ' skipped' : ''}" data-obj-id="${id}">
          <div class="obj-name">${name}</div>
          <div class="obj-id">#${id}</div>
          <div class="obj-state">${skipped ? 'Skipped' : 'Printing'}</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.skip-object-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const id = tile.getAttribute('data-obj-id');
        if (this._skippedObjectIds.has(id)) return; // already skipped, no-op
        this._callService('bambu_lab', 'skip_objects', { device_id: deviceId, objects: id });
        this._skippedObjectIds.add(id);
        this._updateSkipObjectsGrid();
      });
    });
  }

  // ==========================================================================
  // SKIP OBJECTS MODAL — tap-on-image, same data model & functionality as
  // the official ha-bambulab print-status card:
  //   - `printable_objects_entity`.attributes.objects  = {"320": "Name", ...}
  //   - `skipped_objects_entity`.attributes.objects    = [320, 1463, ...]
  //   - `pick_image_entity`.attributes.entity_picture  = a build-plate render
  //     where every object is flood-filled with its own flat RGB color, so a
  //     click can be mapped back to an object id by sampling that pixel.
  //   - bambu_lab.skip_objects is called with a comma-joined id list.
  // Packing/unpacking the color follows the same scheme as the official
  // card: id = r | (g << 8) | (b << 16).
  // ==========================================================================
  // ==========================================================================
  // HOME TAB DOCKED DETAIL PANEL
  // Keeps the camera feed permanently visible on the Home tab while Skip
  // Objects / Move / Filament sync render *next to it* instead of as a
  // full-screen modal. Implemented by reparenting the real, already-wired
  // markup (modal-body or the Movement tab's control card) into the docked
  // slot, then moving it back to its original home on close/tab-change —
  // no duplicated ids, no duplicated logic.
  // ==========================================================================
  _dockHomeDetail(title, sourceId) {
    const panel = this.shadowRoot.getElementById('home-detail-panel');
    const body = this.shadowRoot.getElementById('home-detail-body');
    const titleEl = this.shadowRoot.getElementById('home-detail-title');
    const grid = this.shadowRoot.getElementById('home-grid');
    if (!panel || !body) return;

    this._undockHomeDetail();

    const source = this.shadowRoot.getElementById(sourceId);
    if (!source) return;
    const isModal = source.classList.contains('modal-overlay');
    const contentEl = isModal ? source.querySelector('.modal-body') : (source.querySelector('.grid-responsive-2') || source);
    if (!contentEl) return;

    this._homeDetailOrigin = { el: contentEl, parent: contentEl.parentElement, next: contentEl.nextSibling };
    body.appendChild(contentEl);
    if (titleEl) titleEl.textContent = title;
    panel.style.display = 'flex';
    grid?.classList.add('has-detail');

    // Hide the now-empty source modal so it doesn't render as a blank
    // full-screen backdrop behind the docked panel.
    if (isModal) source.classList.remove('open');
  }

  _undockHomeDetail() {
    const panel = this.shadowRoot.getElementById('home-detail-panel');
    const grid = this.shadowRoot.getElementById('home-grid');
    if (this._homeDetailOrigin) {
      const { el, parent, next } = this._homeDetailOrigin;
      if (parent) parent.insertBefore(el, next || null);
      this._homeDetailOrigin = null;
    }
    if (panel) panel.style.display = 'none';
    grid?.classList.remove('has-detail');
  }

  _decodeSkipColorId(r, g, b) {
    return (r | (g << 8) | (b << 16)) >>> 0;
  }

  _encodeSkipColor(r, g, b) {
    return `rgb(${r}, ${g}, ${b})`;
  }

  _openSkipObjectsModal() {
    const modal = this.shadowRoot.getElementById('skip-objects-modal');
    if (!modal) return;

    // Build the object map fresh from the two sensors every time the modal
    // opens, same as the official card does on state update.
    const printableEntity = this._config.printable_objects_entity || this._resolveBambuEntity('printable_objects');
    const skippedEntity = this._config.skipped_objects_entity || this._resolveBambuEntity('skipped_objects');
    const printable = printableEntity ? this._hass?.states[printableEntity]?.attributes?.objects : null;
    const skippedList = skippedEntity ? this._hass?.states[skippedEntity]?.attributes?.objects : null;

    const map = new Map();
    if (printable && typeof printable === 'object') {
      const skippedSet = new Set((skippedList || []).map(n => Number(n)));
      Object.entries(printable).forEach(([id, name]) => {
        const numId = Number(id);
        const alreadySkipped = skippedSet.has(numId) || this._skippedObjectIds.has(String(id));
        map.set(numId, { name, skipped: alreadySkipped, to_skip: alreadySkipped });
      });
    }
    this._skipObjectsMap = map;
    this._hoveredSkipObjectId = 0;

    this._renderSkipChecklist();
    this._loadSkipPickImage();
    modal.classList.add('open');
  }

  _closeSkipObjectsModal() {
    const modal = this.shadowRoot.getElementById('skip-objects-modal');
    modal?.classList.remove('open');
    this._undockHomeDetail();
    // Reset any un-sent selections back to the printer's real skipped state,
    // same "cancel discards pending taps" behavior as the official popup.
    this._skipObjectsMap.forEach((obj, id) => { obj.to_skip = obj.skipped; });
  }

  _loadSkipPickImage() {
    const img = this.shadowRoot.getElementById('skip-build-plate');
    const canvas = this.shadowRoot.getElementById('skip-canvas');
    const empty = this.shadowRoot.getElementById('skip-image-empty');
    const entityId = this._config.pick_image_entity || this._resolveBambuEntity('pick_image');
    const picture = entityId ? this._hass?.states[entityId]?.attributes?.entity_picture : null;

    if (!picture || !img || !canvas) {
      if (img) img.style.display = 'none';
      if (canvas) canvas.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    // Offscreen canvas holds the raw, undecorated color-id image so we can
    // keep sampling exact object colors after we've painted over the
    // visible canvas with the green/red/outline overlay.
    if (!this._skipPickCanvas) {
      this._skipPickCanvas = document.createElement('canvas');
      this._skipPickCanvas.width = 512;
      this._skipPickCanvas.height = 512;
      this._skipPickCtx = this._skipPickCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this._skipVisibleCtx) {
      this._skipVisibleCtx = canvas.getContext('2d', { willReadFrequently: true });
    }

    const image = new Image();
    image.onload = () => {
      this._skipPickCtx.clearRect(0, 0, 512, 512);
      this._skipPickCtx.drawImage(image, 0, 0, 512, 512);
      img.style.display = 'none';
      canvas.style.display = 'block';
      this._redrawSkipCanvas();
    };
    // Cache-bust so a re-slice / re-plate always gets a fresh pick image.
    image.src = picture.includes('?') ? `${picture}&t=${Date.now()}` : `${picture}?t=${Date.now()}`;
  }

  // Repaints the visible canvas from the offscreen color-id source: every
  // object pixel becomes red if marked to_skip, green otherwise, plus a
  // cyan outline traced around whichever object is currently hovered
  // (canvas hover or checklist-row hover) — same visual language as the
  // official card, just recolored to this UI's palette.
  _redrawSkipCanvas() {
    if (!this._skipPickCtx || !this._skipVisibleCtx) return;
    const w = 512, h = 512;
    const src = this._skipPickCtx.getImageData(0, 0, w, h);
    const data = src.data;
    const out = this._skipVisibleCtx.createImageData(w, h);
    const outData = out.data;

    const idAt = (x, y) => {
      const i = (y * w + x) * 4;
      return this._decodeSkipColorId(data[i], data[i + 1], data[i + 2]);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const id = idAt(x, y);
        if (id === 0) { outData[i + 3] = 0; continue; }
        const obj = this._skipObjectsMap.get(id);
        const toSkip = !!obj?.to_skip;
        outData[i] = toSkip ? 255 : 0;
        outData[i + 1] = toSkip ? 93 : 174;
        outData[i + 2] = toSkip ? 93 : 66;
        outData[i + 3] = 200;

        if (this._hoveredSkipObjectId && id === this._hoveredSkipObjectId) {
          const isEdge =
            (x > 0 && idAt(x - 1, y) !== id) || (x < w - 1 && idAt(x + 1, y) !== id) ||
            (y > 0 && idAt(x, y - 1) !== id) || (y < h - 1 && idAt(x, y + 1) !== id);
          if (isEdge) { outData[i] = 56; outData[i + 1] = 189; outData[i + 2] = 248; outData[i + 3] = 255; }
        }
      }
    }
    this._skipVisibleCtx.putImageData(out, 0, 0);
  }

  _onSkipCanvasClick(e) {
    if (!this._skipPickCtx) return;
    const canvas = this.shadowRoot.getElementById('skip-canvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = 512 / rect.width;
    const scaleY = 512 / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    const px = this._skipPickCtx.getImageData(x, y, 1, 1).data;
    const id = this._decodeSkipColorId(px[0], px[1], px[2]);
    if (id === 0) return;
    this._toggleSkipObjectSelection(id);
  }

  _toggleSkipObjectSelection(id) {
    const obj = this._skipObjectsMap.get(id);
    if (!obj || obj.skipped) return; // already skipped on the printer — irreversible, no-op
    obj.to_skip = !obj.to_skip;
    this._redrawSkipCanvas();
    this._renderSkipChecklist();
  }

  // Mirrors the official card's _isSkipButtonDisabled: Skip stays disabled
  // until at least one not-yet-skipped object is marked to_skip.
  _updateSkipConfirmState() {
    const btn = this.shadowRoot.getElementById('btn-skip-modal-confirm');
    if (!btn) return;
    const hasPending = Array.from(this._skipObjectsMap.values()).some(o => o.to_skip && !o.skipped);
    btn.disabled = !hasPending;
  }

  _renderSkipChecklist() {
    const list = this.shadowRoot.getElementById('skip-checklist');
    if (!list) return;

    if (this._skipObjectsMap.size === 0) {
      list.innerHTML = `<div class="dev-hint">No <code>printable_objects_entity</code> configured, or no objects reported right now.</div>`;
      this._updateSkipConfirmState();
      return;
    }

    list.innerHTML = Array.from(this._skipObjectsMap.entries()).map(([id, obj]) => `
      <label class="skip-check-row${obj.skipped ? ' already-skipped' : ''}" data-obj-id="${id}">
        <input type="checkbox" ${obj.to_skip ? 'checked' : ''} ${obj.skipped ? 'disabled' : ''}>
        <span>${obj.name}${obj.skipped ? ' (already skipped)' : ''}</span>
      </label>`).join('');

    list.querySelectorAll('.skip-check-row').forEach(row => {
      const id = Number(row.getAttribute('data-obj-id'));
      const checkbox = row.querySelector('input');
      checkbox.addEventListener('change', () => this._toggleSkipObjectSelection(id));
      row.addEventListener('mouseenter', () => { this._hoveredSkipObjectId = id; row.classList.add('hovered'); this._redrawSkipCanvas(); });
      row.addEventListener('mouseleave', () => { this._hoveredSkipObjectId = 0; row.classList.remove('hovered'); this._redrawSkipCanvas(); });
    });
    this._updateSkipConfirmState();
  }

  _confirmSkipObjects() {
    const deviceId = this._config.device_id;
    const ids = Array.from(this._skipObjectsMap.entries())
      .filter(([, obj]) => obj.to_skip && !obj.skipped)
      .map(([id]) => id);
    if (ids.length === 0) { this._closeSkipObjectsModal(); return; }

    if (!confirm(`Permanently skip ${ids.length} object(s)? This cannot be undone for the current plate.`)) return;

    this._callService('bambu_lab', 'skip_objects', { device_id: deviceId, objects: ids.join(',') });
    ids.forEach(id => {
      this._skippedObjectIds.add(String(id));
      const obj = this._skipObjectsMap.get(id);
      if (obj) obj.skipped = true;
    });
    this._updateSkipObjectsGrid();
    this._renderSkipChecklist();
    this._redrawSkipCanvas();
    this.shadowRoot.getElementById('skip-objects-modal')?.classList.remove('open');
    this._undockHomeDetail();
  }

  // ==========================================================================
  // TELEMETRY / ANIMATION UPDATE LOOP
  // ==========================================================================
  _pushHistory(arr, value) {
    arr.push(value);
    if (arr.length > this._historyMax) arr.shift();
  }

  _renderSparkline(svgEl, history, min, max) {
    if (!svgEl) return;
    const poly = svgEl.querySelector('polyline');
    if (!poly || history.length < 2) return;
    const range = Math.max(1, max - min);
    const step = 100 / (this._historyMax - 1);
    const startIdx = this._historyMax - history.length;
    const pts = history.map((v, i) => {
      const x = (startIdx + i) * step;
      const y = 26 - ((v - min) / range) * 24;
      return `${x.toFixed(1)},${Math.max(1, Math.min(27, y)).toFixed(1)}`;
    }).join(' ');
    poly.setAttribute('points', pts);
  }

  _applyThermoDial(dialEl, rowEl, current, target, heatingClass) {
    if (!dialEl) return;
    const pct = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : (current > 30 ? 100 : 0);
    dialEl.style.setProperty('--pct', pct.toFixed(0));
    const isHeating = target > 0 && (target - current) > 2;
    dialEl.classList.toggle('pulse', isHeating);
    if (rowEl) rowEl.classList.toggle(heatingClass, isHeating);
  }

  // Single merged live-view box: show the live camera stream whenever the
  // camera is switched on and available, otherwise fall back to the sliced
  // model / object preview image, otherwise show an empty state. Bound as
  // real DOM/property assignments (not stringified template literals) so
  // `.hass`/`.stateObj`/`src` actually stick and stay in sync every update.
  _updateMediaFeeds() {
    if (!this._hass) return;

    const box = this.shadowRoot.getElementById('live-media-box');
    const emptyEl = this.shadowRoot.getElementById('live-media-empty');
    const labelEl = this.shadowRoot.getElementById('live-media-label');
    if (!box) return;

    const camSwitchId = this._config.camera_switch_entity;
    const camSwitchState = camSwitchId ? this._hass.states[camSwitchId] : null;
    // If there's no configured camera on/off switch, assume the camera is
    // meant to be on whenever its entity exists.
    const cameraSwitchedOn = camSwitchState ? camSwitchState.state === 'on' : true;

    const camEntityId = this._config.camera_entity;
    const camState = camEntityId ? this._hass.states[camEntityId] : null;
    const cameraAvailable = !!camState && camState.state !== 'unavailable' && camState.state !== 'off' && cameraSwitchedOn;

    const coverEntityId = this._config.cover_image_entity;
    const coverState = coverEntityId ? this._hass.states[coverEntityId] : null;
    const picturePath = coverState?.attributes?.entity_picture;

    const existingStream = box.querySelector('ha-camera-stream');
    const existingImg = box.querySelector('img');

    if (cameraAvailable) {
      if (existingImg) existingImg.remove();
      let streamEl = existingStream;
      if (!streamEl) {
        streamEl = document.createElement('ha-camera-stream');
        box.insertBefore(streamEl, box.firstChild);
      }
      // These must be set as real JS properties, not HTML attributes.
      streamEl.hass = this._hass;
      streamEl.stateObj = camState;
      streamEl.allowExoPlayer = true;
      streamEl.muted = true;
      if (emptyEl) emptyEl.style.display = 'none';
      if (labelEl) labelEl.textContent = 'Live camera';
    } else if (picturePath) {
      if (existingStream) existingStream.remove();
      let imgEl = existingImg;
      if (!imgEl) {
        imgEl = document.createElement('img');
        box.insertBefore(imgEl, box.firstChild);
      }
      // entity_picture already includes an auth token and changes when the
      // underlying image updates, so using it directly as `src` keeps the
      // preview in sync with whatever model was last loaded.
      if (imgEl.getAttribute('data-src-key') !== picturePath) {
        imgEl.src = picturePath;
        imgEl.setAttribute('data-src-key', picturePath);
      }
      imgEl.onerror = () => { imgEl.remove(); if (emptyEl) emptyEl.style.display = 'flex'; };
      imgEl.onload = () => { if (emptyEl) emptyEl.style.display = 'none'; };
      if (emptyEl) emptyEl.style.display = 'none';
      if (labelEl) labelEl.textContent = 'Object preview';
    } else {
      if (existingStream) existingStream.remove();
      if (existingImg) existingImg.remove();
      if (emptyEl) emptyEl.style.display = 'flex';
      if (labelEl) labelEl.textContent = 'No live feed';
    }
  }

  // Format a remaining-time value as H:MM:SS. The remaining-time sensor
  // reports fractional HOURS (e.g. 0.2166667 == 13 minutes), not minutes —
  // convert to whole seconds first so all three units come out correctly.
  _formatDuration(raw) {
    if (raw === undefined || raw === null || raw === '--' || raw === 'unknown' || raw === 'unavailable') return '--:--:--';
    const totalHours = parseFloat(raw);
    if (Number.isNaN(totalHours) || totalHours < 0) return '--:--:--';
    const totalSeconds = Math.round(totalHours * 3600);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _updateDynamicData() {
    if (!this._hass) return;

    this._updateMediaFeeds();

    const getVal = (key) => this._hass.states[this._config[key]]?.state || '--';

    const status = getVal('print_status_entity');
    const nozzleTemp = parseFloat(getVal('nozzle_temp_entity')) || 0;
    const nozzleTarget = parseFloat(getVal('nozzle_target_entity')) || 0;
    const bedTemp = parseFloat(getVal('bed_temp_entity')) || 0;
    const bedTarget = parseFloat(getVal('bed_target_entity')) || 0;
    const layerCur = getVal('current_layer_entity');
    const layerTot = getVal('total_layers_entity');
    const progress = parseFloat(getVal('progress_entity')) || 0;
    const remaining = getVal('remaining_time_entity');
    const ip = getVal('ip_address_entity');
    const wifi = getVal('wifi_entity');
    const hours = getVal('usage_hours_entity');
    const mqtt = getVal('mqtt_mode_entity');
    const sd = getVal('sd_card_entity');
    const hms = this._hass.states[this._config.hms_entity]?.state === 'on';
    const hmsCode = getVal('hms_code_entity');
    const isPrinting = /print|druk/i.test(status) && !/idle|standby|finish|complet/i.test(status);

    const fanPartState = this._hass.states[this._config.fan_part_entity];
    const fanAuxState = this._hass.states[this._config.fan_aux_entity];
    const fanChamberState = this._hass.states[this._config.fan_chamber_entity];
    const fanPartPct = fanPartState?.attributes?.percentage || (fanPartState?.state === 'on' ? 100 : 0);
    const fanAuxPct = fanAuxState?.attributes?.percentage || (fanAuxState?.state === 'on' ? 100 : 0);
    const fanChamberPct = fanChamberState?.attributes?.percentage || (fanChamberState?.state === 'on' ? 100 : 0);

    const statusPill = this.shadowRoot.getElementById('lbl-status');
    const statusText = this.shadowRoot.getElementById('lbl-status-text');
    if (statusText) statusText.textContent = status;
    if (statusPill) statusPill.classList.toggle('idle', !isPrinting);

    if (this.shadowRoot.getElementById('lbl-nozzle-temp')) this.shadowRoot.getElementById('lbl-nozzle-temp').textContent = nozzleTemp;
    if (this.shadowRoot.getElementById('lbl-nozzle-target')) this.shadowRoot.getElementById('lbl-nozzle-target').textContent = nozzleTarget;
    if (this.shadowRoot.getElementById('lbl-bed-temp')) this.shadowRoot.getElementById('lbl-bed-temp').textContent = bedTemp;
    if (this.shadowRoot.getElementById('lbl-bed-target')) this.shadowRoot.getElementById('lbl-bed-target').textContent = bedTarget;
    if (this.shadowRoot.getElementById('home-nozzle-temp')) this.shadowRoot.getElementById('home-nozzle-temp').textContent = nozzleTemp;
    if (this.shadowRoot.getElementById('home-nozzle-target')) this.shadowRoot.getElementById('home-nozzle-target').textContent = nozzleTarget;
    if (this.shadowRoot.getElementById('home-bed-temp')) this.shadowRoot.getElementById('home-bed-temp').textContent = bedTemp;
    if (this.shadowRoot.getElementById('home-bed-target')) this.shadowRoot.getElementById('home-bed-target').textContent = bedTarget;

    if (this.shadowRoot.getElementById('lbl-layer-stats')) this.shadowRoot.getElementById('lbl-layer-stats').textContent = `${layerCur} / ${layerTot}`;
    if (this.shadowRoot.getElementById('lbl-progress-percent')) this.shadowRoot.getElementById('lbl-progress-percent').textContent = `${progress}%`;
    if (this.shadowRoot.getElementById('lbl-remaining-time')) this.shadowRoot.getElementById('lbl-remaining-time').textContent = this._formatDuration(remaining);

    const barFill = this.shadowRoot.getElementById('home-progress-bar-fill');
    if (barFill) barFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;

    // Home tab: three independent job-control buttons (Play / Pause / Stop),
    // each only enabled when that action is actually valid for the printer's
    // current state — mirrors the on-device touchscreen, which greys out
    // whichever action doesn't apply instead of toggling one shared button.
    const isPaused = /pause|wstrzym/i.test(status);
    const hasActiveJob = isPrinting || isPaused;
    const btnResumeJob = this.shadowRoot.getElementById('btn-resume-job');
    const btnPauseJob = this.shadowRoot.getElementById('btn-pause-job');
    const btnStopJob = this.shadowRoot.getElementById('btn-stop-job');
    if (btnResumeJob) btnResumeJob.disabled = !isPaused;
    if (btnPauseJob) btnPauseJob.disabled = !(isPrinting && !isPaused);
    if (btnStopJob) btnStopJob.disabled = !hasActiveJob;

    // Home tab: speed combobox label mirrors the printer's current profile.
    // Matched case-insensitively since different integration versions/
    // locales have been seen reporting this select's state in either case.
    const speedState = getVal('speed_profile_entity');
    const speedLabelEl = this.shadowRoot.getElementById('home-speed-label');
    if (speedLabelEl && speedState && speedState !== '--') {
      const matchOpt = Array.from(this.shadowRoot.querySelectorAll('#home-speed-list [data-speed]'))
        .find(o => o.getAttribute('data-speed').toLowerCase() === String(speedState).toLowerCase());
      speedLabelEl.textContent = matchOpt ? matchOpt.textContent : speedState;
    }

    this._applyThermoDial(this.shadowRoot.getElementById('temps-nozzle-dial'), this.shadowRoot.getElementById('temps-nozzle-row'), nozzleTemp, nozzleTarget, 'heating');
    this._applyThermoDial(this.shadowRoot.getElementById('temps-bed-dial'), this.shadowRoot.getElementById('temps-bed-row'), bedTemp, bedTarget, 'bed-heating');

    this._pushHistory(this._nozzleHistory, nozzleTemp);
    this._pushHistory(this._bedHistory, bedTemp);
    this._renderSparkline(this.shadowRoot.getElementById('temps-nozzle-spark'), this._nozzleHistory, 0, 320);
    this._renderSparkline(this.shadowRoot.getElementById('temps-bed-spark'), this._bedHistory, 0, 120);

    const fanPartVal = this.shadowRoot.getElementById('lbl-fan-part-val');
    const fanAuxVal = this.shadowRoot.getElementById('lbl-fan-aux-val');
    const fanChamberVal = this.shadowRoot.getElementById('lbl-fan-chamber-val');
    const fanPartVal2 = this.shadowRoot.getElementById('home-fan-part-val');
    if (fanPartVal) fanPartVal.textContent = `${fanPartPct}%`;
    if (fanAuxVal) fanAuxVal.textContent = `${fanAuxPct}%`;
    if (fanChamberVal) fanChamberVal.textContent = `${fanChamberPct}%`;
    if (fanPartVal2) fanPartVal2.textContent = `${fanPartPct}%`;

    this._applyFanAnimation(this.shadowRoot.getElementById('fan-part-icon'), fanPartPct);
    this._applyFanAnimation(this.shadowRoot.getElementById('fan-aux-icon'), fanAuxPct);
    this._applyFanAnimation(this.shadowRoot.getElementById('fan-chamber-icon'), fanChamberPct);

    // ---------------- Power monitoring ----------------
    // Current/Power-now/Total-energy come straight off the mains smart
    // plug's own sensors. "This print" isn't something the plug or printer
    // reports directly, so it's derived: the moment a print transitions
    // from not-running to running, the lifetime total-energy reading is
    // snapshotted as a baseline, and everything since is (current total -
    // baseline). The baseline is also stashed in localStorage (per
    // device_id) so a mid-print browser/page reload doesn't lose it.
    const powerCurrentRaw = this._config.power_current_entity ? this._hass.states[this._config.power_current_entity]?.state : null;
    const powerNowRaw = this._config.power_consumption_entity ? this._hass.states[this._config.power_consumption_entity]?.state : null;
    const powerTotalRaw = this._config.power_total_energy_entity ? this._hass.states[this._config.power_total_energy_entity]?.state : null;
    const powerCurrent = powerCurrentRaw != null ? parseFloat(powerCurrentRaw) : NaN;
    const powerNow = powerNowRaw != null ? parseFloat(powerNowRaw) : NaN;
    const powerTotal = powerTotalRaw != null ? parseFloat(powerTotalRaw) : NaN;

    const elPowerCurrent = this.shadowRoot.getElementById('home-power-current');
    const elPowerNow = this.shadowRoot.getElementById('home-power-now');
    const elPowerTotal = this.shadowRoot.getElementById('home-power-total');
    const elPowerPrint = this.shadowRoot.getElementById('home-power-print');
    if (elPowerCurrent) elPowerCurrent.textContent = !Number.isNaN(powerCurrent) ? `${powerCurrent.toFixed(2)} A` : '-- A';
    if (elPowerNow) elPowerNow.textContent = !Number.isNaN(powerNow) ? `${powerNow.toFixed(1)} W` : '-- W';
    if (elPowerTotal) elPowerTotal.textContent = !Number.isNaN(powerTotal) ? `${powerTotal.toFixed(3)} kWh` : '-- kWh';

    const energyBaselineKey = `bocc_energy_baseline_${this._config.device_id || 'default'}`;
    if (isPrinting && !this._wasPrinting && !Number.isNaN(powerTotal)) {
      this._printEnergyBaseline = powerTotal;
      try { localStorage.setItem(energyBaselineKey, String(powerTotal)); } catch (e) { /* storage unavailable, keep in-memory only */ }
    }
    if (this._printEnergyBaseline === null) {
      try {
        const stored = localStorage.getItem(energyBaselineKey);
        if (stored !== null) this._printEnergyBaseline = parseFloat(stored);
      } catch (e) { /* storage unavailable */ }
    }
    this._wasPrinting = isPrinting;

    if (elPowerPrint) {
      if (!Number.isNaN(powerTotal) && this._printEnergyBaseline !== null && !Number.isNaN(this._printEnergyBaseline)) {
        const printEnergy = Math.max(0, powerTotal - this._printEnergyBaseline);
        elPowerPrint.textContent = `${printEnergy.toFixed(3)} kWh`;
      } else {
        elPowerPrint.textContent = '-- kWh';
      }
    }

    if (this.shadowRoot.getElementById('sys-ip')) this.shadowRoot.getElementById('sys-ip').textContent = ip;
    if (this.shadowRoot.getElementById('sys-wifi')) this.shadowRoot.getElementById('sys-wifi').textContent = wifi;
    if (this.shadowRoot.getElementById('sys-hours')) this.shadowRoot.getElementById('sys-hours').textContent = hours;
    if (this.shadowRoot.getElementById('sys-mqtt')) this.shadowRoot.getElementById('sys-mqtt').textContent = mqtt;
    if (this.shadowRoot.getElementById('sys-sd')) this.shadowRoot.getElementById('sys-sd').textContent = sd;

    this._updateSkipObjectsGrid();

    const amsHum = getVal('ams_humidity_entity');
    const amsTemp = getVal('ams_temperature_entity');
    if (this.shadowRoot.getElementById('lbl-ams-hum')) this.shadowRoot.getElementById('lbl-ams-hum').textContent = amsHum;
    if (this.shadowRoot.getElementById('lbl-ams-temp')) this.shadowRoot.getElementById('lbl-ams-temp').textContent = amsTemp;

    // Resolve which tray index (if any) is currently active/loaded. Prefer an
    // explicit active_tray_entity if the user configured one; otherwise fall
    // back to each tray's own boolean `active` attribute. (The previous logic
    // compared `tray_info_idx === active_tray` on the *same* entity's
    // attributes — when an integration doesn't expose both, that's
    // `undefined === undefined`, i.e. `true` for every slot, so every slot lit
    // up as "active". Fixed below.)
    let resolvedActiveIdx = null;
    if (this._config.active_tray_entity) {
      const activeEntState = this._hass.states[this._config.active_tray_entity];
      const rawActive = activeEntState?.attributes?.tray_index ?? activeEntState?.state;
      const parsedActive = parseInt(rawActive, 10);
      if (!Number.isNaN(parsedActive)) resolvedActiveIdx = parsedActive;
    }

    this._lastActiveTrayIdx = resolvedActiveIdx !== null ? resolvedActiveIdx : (this._lastActiveTrayIdx ?? 0);

    if (Array.isArray(this._config.ams_trays)) {
      this._config.ams_trays.forEach((trayEntity, idx) => {
        const stateObj = this._hass.states[trayEntity];
        if (!stateObj) return;

        const matLbl = this.shadowRoot.getElementById(`spool-mat-${idx}`);
        const colRing = this.shadowRoot.getElementById(`spool-color-${idx}`);
        const slotBox = this.shadowRoot.getElementById(`ams-slot-${idx}`);
        const remainBar = this.shadowRoot.getElementById(`spool-remain-bar-${idx}`);
        const remainLbl = this.shadowRoot.getElementById(`spool-remain-lbl-${idx}`);
        const homeSwatch = this.shadowRoot.getElementById(`home-ams-swatch-${idx}`);

        const brand = stateObj.attributes?.brand || stateObj.attributes?.tray_brand || 'Bambu';
        const subty = stateObj.attributes?.subty || stateObj.attributes?.tray_type || stateObj.attributes?.material || stateObj.state || 'PLA';
        const colorHex = stateObj.attributes?.color || stateObj.attributes?.cols?.[0] || '00AE42';
        const remain = stateObj.attributes?.remain ?? stateObj.attributes?.tray_remain ?? 100;
        const normalizedColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`;

        let isActive;
        if (resolvedActiveIdx !== null) {
          isActive = resolvedActiveIdx === idx;
        } else {
          isActive = stateObj.attributes?.active === true || stateObj.attributes?.active === 'true';
        }
        if (isActive) this._lastActiveTrayIdx = idx;

        // Some ha-bambulab attribute combinations (subty/tray_type/material)
        // already report the full name including the brand, e.g. "Bambu PLA
        // Basic" — prefixing `brand` again on top of that produced the
        // doubled "Bambu Bambu PLA Basic" label. Only prefix the brand when
        // `subty` doesn't already start with it.
        const displayName = subty.toLowerCase().startsWith(String(brand).toLowerCase())
          ? subty
          : `${brand} ${subty}`;

        if (matLbl) matLbl.textContent = displayName;
        if (colRing) colRing.style.borderColor = normalizedColor;
        if (remainBar) remainBar.style.width = `${remain}%`;
        if (remainLbl) remainLbl.textContent = `${remain}% Remaining`;
        if (homeSwatch) {
          homeSwatch.style.background = normalizedColor;
          homeSwatch.title = `AMS Slot ${idx + 1} — ${subty}`;
          homeSwatch.classList.toggle('active', !!isActive);
        }

        if (slotBox) slotBox.classList.toggle('active', !!isActive);
        if (colRing) colRing.classList.toggle('spinning', !!isActive && isPrinting);
        if (slotBox) slotBox.classList.toggle('feeding', !!isActive && isPrinting);
      });
    }

    const extObj = this._hass.states[this._config.external_spool_entity];
    if (extObj) {
      const extMat = this.shadowRoot.getElementById('ext-spool-mat');
      const extColor = this.shadowRoot.getElementById('ext-spool-color');
      const extStatus = this.shadowRoot.getElementById('ext-spool-status');
      const extSlotBox = this.shadowRoot.getElementById('ext-spool-slot');

      const brand = extObj.attributes?.brand || 'Generic';
      const subty = extObj.attributes?.subty || extObj.attributes?.tray_type || extObj.state || 'TPU';
      const colorHex = extObj.attributes?.color || 'FF9500';
      const extActive = extObj.state === 'on' || extObj.attributes?.active === true || extObj.attributes?.active === 'true';

      if (extMat) extMat.textContent = `${brand} ${subty}`;
      if (extColor) { extColor.style.borderColor = colorHex.startsWith('#') ? colorHex : `#${colorHex}`; extColor.classList.toggle('spinning', !!extActive && isPrinting); }
      if (extStatus) extStatus.textContent = extActive ? 'Active Feeding' : 'Idle / Standby';
      if (extSlotBox) extSlotBox.classList.toggle('feeding', !!extActive && isPrinting);
      if (extSlotBox) extSlotBox.classList.toggle('active', !!extActive);
    }

    const banner = this.shadowRoot.getElementById('hms-banner');
    const hmsText = this.shadowRoot.getElementById('hms-description-text');
    if (banner) {
      if (hms) {
        banner.classList.add('visible');
        if (hmsText) hmsText.textContent = this._hmsDatabase[hmsCode] || `Active Diagnostic Code: ${hmsCode}.`;
      } else {
        banner.classList.remove('visible');
      }
    }

    this._scheduleFit();
  }

  _applyFanAnimation(iconEl, pct) {
    if (!iconEl) return;
    const running = pct > 0;
    iconEl.classList.toggle('stopped', !running);
    iconEl.style.animationDuration = running ? `${(2.0 / (pct / 25)).toFixed(2)}s` : '0s';
    iconEl.classList.remove('blur-low', 'blur-med', 'blur-high');
    if (pct >= 75) iconEl.classList.add('blur-high');
    else if (pct >= 40) iconEl.classList.add('blur-med');
    else if (pct > 0) iconEl.classList.add('blur-low');
  }

  // ==========================================================================
  // PRINT HISTORY / REPRINT TAB
  // ==========================================================================
  _splitCacheEntry(raw, date) {
    const parts = raw.split('/');
    const name = parts[parts.length - 1];
    // Bambu cache filenames are prefixed with a numeric task/job id (e.g.
    // "3863022-Strong Single-Color Print Profile.3mf") that increases over
    // time — useful as a sort fallback when the folder sensor doesn't
    // expose a real per-file modified/created timestamp (very common: most
    // "folder" sensor integrations only return a bare file_list of names).
    const idMatch = name.match(/^(\d{4,})[-_]/);
    const taskId = idMatch ? parseInt(idMatch[1], 10) : null;
    if (parts.length === 1) return { name, dir: null, date: date ?? null, taskId };

    const dirPath = parts.slice(0, -1).join('/') + '/';
    let dir = null;
    if (dirPath.startsWith('/config/www/')) {
      dir = dirPath.replace('/config/www/', '/local/');
    } else if (dirPath.startsWith('/config/media/')) {
      dir = dirPath.replace('/config/media/', '/media/local/');
    } else if (dirPath.startsWith('/media/')) {
      dir = dirPath;
    } else if (dirPath.startsWith('/local/')) {
      dir = dirPath;
    }
    return { name, dir, date: date ?? null, taskId };
  }

  // Normalizes whatever date shape a folder sensor happens to expose
  // (epoch seconds, epoch ms, or an ISO/RFC date string) into a comparable
  // millisecond timestamp, or null if it can't be parsed.
  _toTimestamp(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  _updatePrintHistoryList() {
    const container = this.shadowRoot.getElementById('reprint-file-container');
    if (!container) return;

    const currentTaskState = this._hass?.states[this._config.task_name_entity];
    const currentTaskRaw = currentTaskState?.state;
    const currentTaskEntry = (currentTaskRaw && currentTaskRaw !== 'unknown' && currentTaskRaw !== 'unavailable')
      // last_changed is the closest thing we have to a "date" for the
      // currently-loaded task, since the task-name entity itself usually
      // has no timestamp attribute of its own.
      ? this._splitCacheEntry(currentTaskRaw.replace(/\.gcode$/i, '.3mf'), currentTaskState?.last_changed || null)
      : null;

    let dynamicRaw = [];
    const cacheSensor = this._hass?.states[this._config.folder_sensor];
    if (cacheSensor && cacheSensor.attributes) {
      const attrFiles = cacheSensor.attributes.files || cacheSensor.attributes.file_list || cacheSensor.attributes.items;
      if (Array.isArray(attrFiles)) {
        dynamicRaw = attrFiles.map(f => {
          if (typeof f === 'string') return { name: f, date: null };
          const name = f.name || f.filename || f.path;
          // Folder-watcher sensors vary in what they call the timestamp
          // field, so we check the common spellings rather than assuming one.
          const date = f.last_modified ?? f.modified ?? f.mtime ?? f.created ?? f.created_at ?? f.date ?? null;
          return { name, date };
        }).filter(f => f.name);
      }
    }

    const allEntries = [
      ...(currentTaskEntry ? [currentTaskEntry] : []),
      ...dynamicRaw.map(f => this._splitCacheEntry(f.name, f.date))
    ]
      .filter(e => e.name && (/\.3mf$/i.test(e.name) || /\.gcode$/i.test(e.name)))
      .map(e => ({ ...e, name: e.name.replace(/\.gcode$/i, '.3mf') }));

    const detectedDir = allEntries.find(e => e.dir)?.dir || this._config.thumbnail_base_path || '/local/cache/';

    // One row per unique filename; first entry with a date/dir we see wins
    // (currentTaskEntry is listed first, so it takes priority when present).
    const seen = new Map();
    allEntries.forEach(e => {
      if (!seen.has(e.name)) {
        seen.set(e.name, { dir: e.dir || detectedDir, date: this._toTimestamp(e.date), taskId: e.taskId ?? null });
      } else {
        const existing = seen.get(e.name);
        if (existing.date === null && e.date) existing.date = this._toTimestamp(e.date);
        if (existing.taskId === null && e.taskId !== null) existing.taskId = e.taskId;
      }
    });

    let masterFileList = [...seen.keys()];
    const dirByName = new Map([...seen.entries()].map(([k, v]) => [k, v.dir]));
    const dateByName = new Map([...seen.entries()].map(([k, v]) => [k, v.date]));
    const taskIdByName = new Map([...seen.entries()].map(([k, v]) => [k, v.taskId]));

    // Sort by created/modified date when we have one; otherwise fall back
    // to the numeric task id embedded in the filename (most folder-watcher
    // sensors only expose bare filenames with no per-file timestamp, which
    // is why sorting looked like it did nothing before — there was simply
    // no date to sort by). Files with neither sort to the back.
    if (this._historySortDir) {
      const dir = this._historySortDir === 'asc' ? 1 : -1;
      masterFileList.sort((a, b) => {
        const da = dateByName.get(a) ?? taskIdByName.get(a) ?? null;
        const db = dateByName.get(b) ?? taskIdByName.get(b) ?? null;
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return (da - db) * dir;
      });
    }

    const totalItems = masterFileList.length;

    if (totalItems === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 19 9"/></svg>
          <div style="font-weight:700; color:#17202b;">No cached 3MF files found</div>
          <div style="font-size:12px;">Check that <code>${this._config.folder_sensor}</code> is reporting a file list, or print a job to populate the cache.</div>
        </div>`;
      const lblRange = this.shadowRoot.getElementById('lbl-page-range');
      if (lblRange) lblRange.textContent = 'Showing 0 of 0';
      const btnPrev = this.shadowRoot.getElementById('btn-page-prev');
      const btnNext = this.shadowRoot.getElementById('btn-page-next');
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(totalItems / this._pageSize));
    if (this._currentPage > totalPages) this._currentPage = totalPages;
    if (this._currentPage < 1) this._currentPage = 1;

    const startIndex = (this._currentPage - 1) * this._pageSize;
    const endIndex = Math.min(startIndex + this._pageSize, totalItems);
    const paginatedFiles = masterFileList.slice(startIndex, endIndex);

    const lblRange = this.shadowRoot.getElementById('lbl-page-range');
    const btnPrev = this.shadowRoot.getElementById('btn-page-prev');
    const btnNext = this.shadowRoot.getElementById('btn-page-next');
    if (lblRange) lblRange.textContent = `Showing ${startIndex + 1}–${endIndex} of ${totalItems}`;
    if (btnPrev) btnPrev.disabled = this._currentPage <= 1;
    if (btnNext) btnNext.disabled = this._currentPage >= totalPages;

    container.innerHTML = paginatedFiles.map((cleanFileName) => {
      const pngFilename = cleanFileName.replace(/\.3mf$/i, '.png');
      const dir = dirByName.get(cleanFileName) || detectedDir;
      const imageUrl = `${dir}${encodeURIComponent(pngFilename)}`;
      const isCurrent = currentTaskEntry && cleanFileName === currentTaskEntry.name;
      const dateTs = dateByName.get(cleanFileName);
      const dateLabel = dateTs ? new Date(dateTs).toLocaleString() : 'Date unknown';
      const baseName = cleanFileName.replace(/\.3mf$/i, '');

      return `
        <div class="file-item${isCurrent ? ' current-task' : ''}">
          <div class="file-info">
            <img class="file-preview-img" src="${imageUrl}" alt="Preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="file-icon-placeholder" style="display:none;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 19 9"/></svg>
            </div>
            <div>
              <div style="font-weight:700; font-size:14px; color:#17202b;">${cleanFileName}${isCurrent ? ' <span class="material-chip" style="margin-left:6px;">Current</span>' : ''}</div>
              <div style="font-size:11px; color:#6b7686;">MicroSD Cache · ${dateLabel}</div>
            </div>
          </div>
          <div class="file-actions">
            <button class="btn primary btn-trigger-reprint" data-filename="${cleanFileName}" style="padding:8px 16px; font-size:12px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg> Start Print
            </button>
            <button class="icon-btn-ghost btn-delete-cache-files" data-basename="${baseName}" title="Delete ${baseName}.3mf, .png and .gcode">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="9" width="12" height="8" rx="1"/><path d="M8 9V4h8v5"/><path d="M9 17v3h6v-3"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-trigger-reprint').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedReprintFile = btn.getAttribute('data-filename');
        const modal = this.shadowRoot.getElementById('reprint-modal');
        const nameInput = this.shadowRoot.getElementById('reprint-file-name-display');
        if (nameInput) nameInput.value = this._selectedReprintFile;
        const rows = this.shadowRoot.getElementById('reprint-mapping-rows');
        if (rows) rows.innerHTML = '';
        this._addReprintMappingRow();
        if (modal) modal.classList.add('open');
      });
    });

    container.querySelectorAll('.btn-delete-cache-files').forEach(btn => {
      btn.addEventListener('click', () => this._deleteCacheFileTrio(btn.getAttribute('data-basename')));
    });

    this._scheduleFit();
  }

  // Deletes the .3mf + matching .png + .gcode trio for a cached file. HA has
  // no built-in generic "delete a file" service, so this calls whatever
  // shell_command/script the user configured via delete_cache_files_service
  // — if nothing's configured, it explains what to set up instead of
  // silently doing nothing.
  _deleteCacheFileTrio(baseName) {
    if (!baseName || !this._hass) return;
    const serviceRef = this._config.delete_cache_files_service;
    if (!serviceRef || !serviceRef.includes('.')) {
      alert(
        `No delete_cache_files_service is configured, so there's nothing to call.\n\n` +
        `Home Assistant has no built-in generic "delete a file" service — add a shell_command ` +
        `to configuration.yaml, pointed at the real filesystem path under ha-bambulab's media ` +
        `folder (NOT "/local/...", which is only a frontend alias the shell can't see), e.g.:\n\n` +
        `shell_command:\n` +
        `  delete_bambu_cache_files: "rm -f /config/www/media/ha-bambulab/<PRINTER_SERIAL>/prints/cache/{{ basename }}.3mf /config/www/media/ha-bambulab/<PRINTER_SERIAL>/prints/cache/{{ basename }}.png /config/www/media/ha-bambulab/<PRINTER_SERIAL>/prints/cache/{{ basename }}.gcode"\n\n` +
        `Then set delete_cache_files_service: "shell_command.delete_bambu_cache_files" in this card's config.`
      );
      return;
    }
    if (!confirm(`Permanently delete ${baseName}.3mf, ${baseName}.png and ${baseName}.gcode from the cache? This cannot be undone.`)) return;

    const [domain, service] = serviceRef.split('.');
    const paramName = this._config.delete_cache_files_param || 'basename';
    this._callService(domain, service, { [paramName]: baseName });

    // Optimistic removal so it feels instant...
    const container = this.shadowRoot.getElementById('reprint-file-container');
    const tile = container?.querySelector(`.btn-delete-cache-files[data-basename="${baseName}"]`)?.closest('.file-item');
    if (tile) tile.remove();

    // ...but "gone from the list, back after refresh" means the shell
    // command didn't actually delete the file on disk — most commonly
    // because it targets `/local/...`, which is only an HTTP alias the
    // frontend understands, not a real filesystem path the shell can see.
    // The real path on disk is `/config/www/...`. Force the folder sensor
    // to rescan, then check whether the file is really gone; if it isn't,
    // put the tile back and say so instead of pretending it worked.
    const folderSensor = this._config.folder_sensor;
    if (folderSensor && this._hass.states[folderSensor]) {
      this._callService('homeassistant', 'update_entity', { entity_id: folderSensor });
    }
    setTimeout(() => {
      const sensorNow = this._hass?.states[folderSensor];
      const filesNow = sensorNow?.attributes?.files || sensorNow?.attributes?.file_list || sensorNow?.attributes?.items || [];
      const stillThere = Array.isArray(filesNow) && filesNow.some(f => {
        const name = typeof f === 'string' ? f : (f.name || f.filename || f.path || '');
        return name.includes(baseName);
      });
      if (stillThere) {
        alert(
          `${baseName}.3mf is still on disk — the delete command didn't actually remove it.\n\n` +
          `Your shell_command most likely points at "/local/..." — that path only exists inside ` +
          `Home Assistant's frontend (it's an alias for /config/www/), the shell running the rm ` +
          `command can't see it. Point it at the real filesystem path instead, e.g.:\n\n` +
          `shell_command:\n` +
          `  delete_bambu_cache_files: "rm -f /config/www/media/ha-bambulab/<PRINTER_SERIAL>/prints/cache/{{ basename }}.3mf /config/www/media/ha-bambulab/<PRINTER_SERIAL>/prints/cache/{{ basename }}.png /config/www/media/ha-bambulab/<PRINTER_SERIAL>/prints/cache/{{ basename }}.gcode"\n\n` +
          `(adjust the folder to wherever your cache files actually live under /config/www/media/ha-bambulab/).`
        );
        this._updatePrintHistoryList();
      }
    }, 2500);
  }

  // Adds one "Filament N: [tray dropdown]" row to the reprint modal — same
  // idea as the official card's per-filament AMS mapping list, just without
  // auto-detecting the file's filament count (that needs unzipping the
  // 3MF's slice metadata, which this card doesn't parse). The user adds one
  // row per color/filament their file actually uses.
  _addReprintMappingRow() {
    const container = this.shadowRoot.getElementById('reprint-mapping-rows');
    if (!container) return;
    const rowIndex = container.children.length;
    const row = document.createElement('div');
    row.className = 'reprint-mapping-row';
    row.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px;';
    row.innerHTML = `
      <span style="font-size:12px; color:#6b7686; min-width:64px;">Filament ${rowIndex + 1}:</span>
      <select class="reprint-mapping-select" style="flex:1;">
        <option value="0">AMS Slot 1</option>
        <option value="1">AMS Slot 2</option>
        <option value="2">AMS Slot 3</option>
        <option value="3">AMS Slot 4</option>
        <option value="254">External Spool Holder</option>
      </select>
      <button class="icon-btn-ghost btn-remove-mapping-row" title="Remove this filament">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="9" width="12" height="8" rx="1"/><path d="M8 9V4h8v5"/><path d="M9 17v3h6v-3"/></svg>
      </button>
    `;
    container.appendChild(row);
    row.querySelector('.btn-remove-mapping-row').addEventListener('click', () => {
      if (container.children.length > 1) row.remove();
    });
  }

  _executeHandyStyleReprint() {
    if (!this._selectedReprintFile || !this._hass) return;

    const mappingSelects = Array.from(this.shadowRoot.querySelectorAll('#reprint-mapping-rows .reprint-mapping-select'));
    const trayValues = mappingSelects.length ? mappingSelects.map(s => parseInt(s.value, 10)) : [0];
    const isExternalSpool = trayValues.every(v => v === 254);
    const useAms = isExternalSpool ? false : (this.shadowRoot.getElementById('chk-use-ams')?.checked ?? true);
    const bedLeveling = this.shadowRoot.getElementById('chk-bed-leveling')?.checked ?? true;
    const flowCali = this.shadowRoot.getElementById('chk-flow-cali')?.checked ?? false;
    const vibrationCali = this.shadowRoot.getElementById('chk-vibration-cali')?.checked ?? false;
    const layerInspect = this.shadowRoot.getElementById('chk-layer-inspect')?.checked ?? false;
    const timelapse = this.shadowRoot.getElementById('chk-timelapse')?.checked ?? true;
    const plate = parseInt(this.shadowRoot.getElementById('reprint-plate-number')?.value, 10) || 1;

    const deviceId = this._config.device_id;
    const fileName = this._selectedReprintFile;
    const cachePath = this._config.sdcard_cache_path || 'cache/';
    // Per the integration's own docs, ams_mapping is a comma-separated
    // STRING of tray indices, one per filament/tool used in the sliced
    // file — e.g. "2,-1,0". Built here from every row the user added
    // (one row per filament), same as the official card's per-filament
    // mapping list, in the order the rows were added.
    const amsMapping = isExternalSpool ? '' : trayValues.join(',');

    if (this._hass.services['bambu_lab'] && this._hass.services['bambu_lab']['print_project_file']) {
      // Matches bambu_lab.print_project_file 1:1: filepath (required),
      // plate, use_ams, ams_mapping, bed_leveling, flow_cali, vibration_cali,
      // layer_inspect, timelapse. (The previous version sent `filename`,
      // which isn't a field this service recognizes, so the actual file
      // path was silently dropped — that's the bug this fixes.)
      this._hass.callService('bambu_lab', 'print_project_file', {
        device_id: deviceId,
        filepath: `${cachePath}${fileName}`,
        plate: plate,
        use_ams: useAms,
        ams_mapping: amsMapping,
        bed_leveling: bedLeveling,
        flow_cali: flowCali,
        vibration_cali: vibrationCali,
        layer_inspect: layerInspect,
        timelapse: timelapse
      });
    } else {
      // Raw MQTT fallback — field names/shape here come from the documented
      // `print.project_file` command (OpenBambuAPI), which differs slightly
      // from the HA service's own field names (e.g. `bed_levelling` with a
      // double L, plus the project/profile/task/subtask id boilerplate the
      // firmware expects for local prints).
      const mqttPayload = {
        print: {
          sequence_id: "0",
          command: "project_file",
          param: `Metadata/plate_${plate}.gcode`,
          project_id: "0",
          profile_id: "0",
          task_id: "0",
          subtask_id: "0",
          subtask_name: fileName,
          file: "",
          url: `file:///sdcard/${cachePath}${fileName}`,
          md5: "",
          timelapse: timelapse,
          bed_type: "auto",
          bed_levelling: bedLeveling,
          flow_cali: flowCali,
          vibration_cali: vibrationCali,
          layer_inspect: layerInspect,
          ams_mapping: amsMapping,
          use_ams: useAms
        }
      };
      this._hass.callService('mqtt', 'publish', { topic: `device/${deviceId}/request`, payload: JSON.stringify(mqttPayload) });
    }
  }

  // Hooks HA's card picker/editor UI up to a dedicated visual editor
  // element instead of requiring YAML. HA calls this itself when the user
  // clicks "Edit" on the card in the dashboard UI.
  static getConfigElement() {
    return document.createElement('bambu-operational-center-card-editor');
  }

  // Minimal config so the card renders something sane the moment it's
  // dropped onto a dashboard, before the user has picked any entities.
  static getStubConfig() {
    return { title: 'BAMBU OPERATIONAL CENTER' };
  }
}

customElements.get('bambu-operational-center-card') || customElements.define('bambu-operational-center-card', BambuOperationalCenterCard);

// ============================================================================
// VISUAL CONFIG EDITOR
// Lets the card be configured from the dashboard UI (device + every sensor/
// entity field) instead of hand-editing YAML, the same way built-in HA cards
// and the official ha-bambulab cards work. Built on <ha-entity-picker> /
// <ha-selector>, which ship globally with the Home Assistant frontend, so no
// extra dependency is needed.
// ============================================================================
const BOCC_FIELD_GROUPS = [
  {
    label: 'Core',
    fields: [
      { key: 'title', label: 'Card Title', type: 'text' },
      { key: 'device_id', label: 'Printer Device', type: 'device', filter: 'bambu_lab' },
    ],
  },
  {
    label: 'Camera & Preview',
    fields: [
      { key: 'camera_entity', label: 'Camera', domain: 'camera' },
      { key: 'camera_switch_entity', label: 'Camera Power Switch', domain: 'switch' },
      { key: 'cover_image_entity', label: 'Model Cover Image', domain: 'image' },
    ],
  },
  {
    label: 'Print Status',
    fields: [
      { key: 'print_status_entity', label: 'Print Status' },
      { key: 'stage_entity', label: 'Print Stage' },
      { key: 'progress_entity', label: 'Print Progress %' },
      { key: 'current_layer_entity', label: 'Current Layer' },
      { key: 'total_layers_entity', label: 'Total Layers' },
      { key: 'remaining_time_entity', label: 'Remaining Time' },
      { key: 'print_error_entity', label: 'Print Error', domain: 'binary_sensor' },
      { key: 'task_name_entity', label: 'Current Task/G-code Filename' },
    ],
  },
  {
    label: 'Temperatures',
    fields: [
      { key: 'nozzle_temp_entity', label: 'Nozzle Temp (current)' },
      { key: 'nozzle_target_entity', label: 'Nozzle Temp (target)', domain: 'number' },
      { key: 'bed_temp_entity', label: 'Bed Temp (current)' },
      { key: 'bed_target_entity', label: 'Bed Temp (target)', domain: 'number' },
      { key: 'chamber_temp_entity', label: 'Chamber Temp' },
    ],
  },
  {
    label: 'Fans & Light',
    fields: [
      { key: 'fan_part_entity', label: 'Part Cooling Fan', domain: 'fan' },
      { key: 'fan_aux_entity', label: 'Aux Fan', domain: 'fan' },
      { key: 'fan_chamber_entity', label: 'Chamber Fan', domain: 'fan' },
      { key: 'light_entity', label: 'Chamber Light', domain: 'light' },
    ],
  },
  {
    label: 'Controls',
    fields: [
      { key: 'pause_entity', label: 'Pause Button', domain: 'button' },
      { key: 'resume_entity', label: 'Resume Button', domain: 'button' },
      { key: 'stop_entity', label: 'Stop Button', domain: 'button' },
      { key: 'full_refresh_entity', label: 'Full State Refresh Button', domain: 'button' },
      { key: 'speed_profile_entity', label: 'Speed Profile', domain: 'select' },
      { key: 'power_switch_entity', label: 'Mains Power Switch', domain: 'switch' },
    ],
  },
  {
    label: 'Power Monitoring',
    fields: [
      { key: 'power_current_entity', label: 'Current (A)' },
      { key: 'power_consumption_entity', label: 'Power Now (W)' },
      { key: 'power_total_energy_entity', label: 'Total Energy — lifetime (kWh)' },
    ],
  },
  {
    label: 'AMS',
    fields: [
      { key: 'ams_humidity_entity', label: 'AMS Humidity' },
      { key: 'ams_temperature_entity', label: 'AMS Temperature' },
      { key: 'active_tray_entity', label: 'Active Tray (optional)' },
      { key: 'ams_tray_0', label: 'AMS Slot 1' },
      { key: 'ams_tray_1', label: 'AMS Slot 2' },
      { key: 'ams_tray_2', label: 'AMS Slot 3' },
      { key: 'ams_tray_3', label: 'AMS Slot 4' },
      { key: 'external_spool_entity', label: 'External Spool' },
    ],
  },
  {
    label: 'System',
    fields: [
      { key: 'wifi_entity', label: 'WiFi Signal' },
      { key: 'hms_entity', label: 'HMS Error', domain: 'binary_sensor' },
      { key: 'hms_code_entity', label: 'HMS Error Code' },
      { key: 'ip_address_entity', label: 'IP Address' },
      { key: 'usage_hours_entity', label: 'Usage Hours' },
      { key: 'mqtt_mode_entity', label: 'MQTT Mode' },
      { key: 'sd_card_entity', label: 'SD Card Status' },
    ],
  },
  {
    label: 'Skip Objects (optional overrides)',
    fields: [
      { key: 'printable_objects_entity', label: 'Printable Objects Entity (auto-detected if blank)' },
      { key: 'skipped_objects_entity', label: 'Skipped Objects Entity (auto-detected if blank)' },
      { key: 'pick_image_entity', label: 'Pick Image Entity (auto-detected if blank)' },
    ],
  },
  {
    label: 'Reprint Cache (advanced)',
    fields: [
      { key: 'folder_sensor', label: 'Cache Folder Sensor' },
      { key: 'thumbnail_base_path', label: 'Thumbnail Base Path', type: 'text' },
      { key: 'sdcard_cache_path', label: 'Printer SD Cache Path', type: 'text' },
      { key: 'delete_cache_files_service', label: 'Delete-File Service (domain.service)', type: 'text' },
      { key: 'delete_cache_files_param', label: 'Delete-File Service Param Name', type: 'text' },
    ],
  },
];

class BambuOperationalCenterCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Entity pickers need `.hass` set on them directly (they're not aware
    // of it otherwise) — only do this once the pickers actually exist.
    if (this.shadowRoot) {
      this.shadowRoot.querySelectorAll('ha-entity-picker, ha-device-picker').forEach(el => { el.hass = hass; });
    }
  }

  _valueChanged(key, value) {
    this._config = { ...this._config, [key]: value };
    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _render() {
    if (!this.shadowRoot) return;
    const amsTrays = Array.isArray(this._config.ams_trays) ? this._config.ams_trays : [];
    const getVal = (key) => {
      if (key.startsWith('ams_tray_')) {
        const idx = parseInt(key.replace('ams_tray_', ''), 10);
        return amsTrays[idx] || '';
      }
      return this._config[key] ?? '';
    };

    const groupsHtml = BOCC_FIELD_GROUPS.map(group => `
      <div class="boc-group">
        <div class="boc-group-title">${group.label}</div>
        ${group.fields.map(f => {
          if (f.type === 'text') {
            return `
              <div class="boc-row">
                <label>${f.label}</label>
                <input type="text" data-key="${f.key}" value="${getVal(f.key)}" />
              </div>`;
          }
          if (f.type === 'device') {
            return `
              <div class="boc-row">
                <label>${f.label}</label>
                <ha-device-picker data-key="${f.key}" .value="${getVal(f.key)}"></ha-device-picker>
              </div>`;
          }
          return `
            <div class="boc-row">
              <label>${f.label}</label>
              <ha-entity-picker data-key="${f.key}"${f.domain ? ` data-domain="${f.domain}"` : ''}></ha-entity-picker>
            </div>`;
        }).join('')}
      </div>
    `).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 8px 4px; }
        .boc-group { margin-bottom: 18px; }
        .boc-group-title { font-weight: 600; font-size: 14px; margin: 12px 0 8px; color: var(--primary-text-color); border-bottom: 1px solid var(--divider-color, #ddd); padding-bottom: 4px; }
        .boc-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
        .boc-row label { font-size: 12px; color: var(--secondary-text-color); }
        .boc-row input[type="text"] {
          padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          font-size: 14px;
        }
      </style>
      ${groupsHtml}
    `;

    // Wire text inputs.
    this.shadowRoot.querySelectorAll('input[type="text"]').forEach(input => {
      input.addEventListener('change', (e) => this._valueChanged(e.target.dataset.key, e.target.value));
    });

    // Wire entity/device pickers.
    this.shadowRoot.querySelectorAll('ha-entity-picker, ha-device-picker').forEach(picker => {
      picker.hass = this._hass;
      const key = picker.dataset.key;
      picker.value = getVal(key);
      if (picker.dataset.domain) picker.includeDomains = [picker.dataset.domain];
      picker.addEventListener('value-changed', (e) => {
        const value = e.detail.value;
        if (key.startsWith('ams_tray_')) {
          const idx = parseInt(key.replace('ams_tray_', ''), 10);
          const trays = Array.isArray(this._config.ams_trays) ? [...this._config.ams_trays] : ['', '', '', ''];
          trays[idx] = value;
          this._valueChanged('ams_trays', trays);
        } else {
          this._valueChanged(key, value);
        }
      });
    });
  }
}

customElements.get('bambu-operational-center-card-editor') || customElements.define('bambu-operational-center-card-editor', BambuOperationalCenterCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'bambu-operational-center-card')) {
  window.customCards.push({
    type: 'bambu-operational-center-card',
    name: 'Bambu Operational Center',
    description: 'Full Bambu Lab printer control center — camera, print status, temps, fans, AMS, controls.',
    preview: false,
  });
}
