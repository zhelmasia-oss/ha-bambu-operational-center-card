# ha-bambu-operational-center-card
A custom Home Assistant card for monitoring and controlling Bambu Lab 3D printers
Bambu Lab Operational Center Card
​A custom Home Assistant card designed to provide comprehensive monitoring and control for Bambu Lab 3D printers, optimized for use on wall-mounted dashboard tablets (such as 7-inch displays).
​Features
​Operational Control & Monitoring: Manage your prints, track progress, and view live states directly from your Home Assistant dashboard.
​Cache Management: Integrated backend tools to handle print cache files cleanly.
​Tablet Optimized: Designed with touch-friendly elements tailored for 7-inch dashboard panels.
​Prerequisites
​Before installing the card, ensure you have set up the necessary backend configuration in Home Assistant to handle file caching and cleanups.
​1. Update configuration.yaml
​Add the external directories allowlist, shell command, and template sensor to your configuration.yaml.
​Important: Make sure to replace 01P00C592600733 with your actual Bambu Lab printer serial number.
homeassistant:
  allowlist_external_dirs:
    - /config/www/media/ha-bambulab/01P00C592600733/prints/cache

shell_command:
  delete_bambu_cache_files: >-
    rm -f
    "{{ states('sensor.bambu_cache_path') }}/{{ basename }}.3mf"
    "{{ states('sensor.bambu_cache_path') }}/{{ basename }}.png"
    "{{ states('sensor.bambu_cache_path') }}/{{ basename }}.gcode"
    "{{ states('sensor.bambu_cache_path') }}/{{ basename }}.slice_info.config"

template:
  - sensor:
      - name: "Bambu Cache Path"
        unique_id: bambu_cache_path
        state: "/config/www/media/ha-bambulab/01P00C592600733/prints/cache"

Installation
​Manual Installation
​Download the latest bambu-operational-center-card.js file from the Releases page.
​Place the file into your Home Assistant www directory (e.g., /config/www/bambu-operational-center-card.js).
​Add the resource to your Home Assistant dashboard:
​Go to Settings > Dashboards > Resources (or manage resources via the three-dot menu).
​Click Add Resource.
​URL: /local/bambu-operational-center-card.js
​Resource type: JavaScript Module.
​Refresh your browser cache.
​Usage
​Once installed, add the card to your dashboard via the Home Assistant UI editor and configure your entities accordingly.
