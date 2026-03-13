# MPQ Patching Guide — WoW 3.3.5a (Build 12340)

## How MPQ Loading Works

WoW 3.3.5a uses MPQ (Mo'PaQ) archives to store all game assets. When multiple MPQs contain the same file, the one loaded **last** wins. Understanding load order is critical.

### Base Load Order

```
1.  common.MPQ
2.  common-2.MPQ
3.  expansion.MPQ
4.  lichking.MPQ
5.  Data/{locale}/locale-{locale}.MPQ
6.  Data/{locale}/expansion-locale-{locale}.MPQ
7.  Data/{locale}/lichking-locale-{locale}.MPQ
```

### Patch Load Order

Patches are loaded in **interleaved** order — each numbered base patch is followed by its locale counterpart:

```
8.  patch.MPQ
9.  Data/{locale}/patch-{locale}.MPQ
10. patch-2.MPQ
11. Data/{locale}/patch-{locale}-2.MPQ
12. patch-3.MPQ
13. Data/{locale}/patch-{locale}-3.MPQ
14. patch-4.MPQ                            ← first available custom slot
15. Data/{locale}/patch-{locale}-4.MPQ     ← (if exists)
...
```

A file in `patch-4.MPQ` overrides the same file from `patch-{locale}-3.MPQ` because it's loaded later.

### Patch Naming Rules

The client only recognizes patches named `patch-{X}.MPQ` where `{X}` is a **single character** (digits `2`–`9`, then letters `A`–`Z`).

| Name               | Loaded? |
|--------------------|---------|
| `patch-4.MPQ`      | Yes     |
| `patch-A.MPQ`      | Yes     |
| `patch-Z.MPQ`      | Yes     |
| `patch-10.MPQ`     | No      |
| `patch-custom.MPQ` | No      |

The same rule applies to locale patches: `patch-{locale}-{X}.MPQ`.

## Creating a Client Patch

### 1. Prepare the directory structure

The directory must mirror the game's internal file paths exactly:

```
my-patch/
├── DBFilesClient/
│   └── Spell.dbc
├── Interface/
│   ├── AddOns/
│   │   └── Blizzard_SomeAddon/
│   │       ├── SomeAddon.toc
│   │       ├── SomeAddon.lua
│   │       └── SomeAddon.xml
│   └── GuildBankFrame/
│       └── SomeTexture.blp
└── ...
```

### 2. Build the MPQ

```bash
cd mpq-builder
npm run mpq -- patch ./my-patch -o patch-4.MPQ
```

### 3. Deploy

Copy the MPQ to `<WoW>/Data/`:

```bash
cp patch-4.MPQ /path/to/wow/Data/
```

Restart the WoW client (MPQs are loaded at startup).

## Overriding Blizzard Addons

Blizzard's built-in addons (like `Blizzard_GuildBankUI`) are signed and secured. Modifying them requires special handling.

### The Secure Addon Problem

Blizzard addons have two protection mechanisms:

1. **`## Secure: 1`** in the `.toc` file — marks the addon as signed
2. **`.TOC.SIG`** file — contains the digital signature

If you override just the `.lua` file, the client detects a signature mismatch and reports the file as **corrupted**.

### How to Override Properly

You must include **all** of these in your patch:

| File | Action |
|------|--------|
| `Addon.toc` | Copy original, **remove** `## Secure: 1` |
| `ADDON.TOC.SIG` | Include as **empty file** (0 bytes) |
| `Addon.lua` | Your modified version |
| `Addon.xml` | Copy original (unchanged) |
| `Localization.lua` | Copy original (unchanged) |

#### Step-by-step example

```bash
# 1. Extract original files from the highest-priority MPQ that contains them
npm run mpq -- extract <path>/patch-frFR-2.MPQ "Interface\AddOns\Blizzard_MyAddon\MyAddon.lua" -o ./originals
npm run mpq -- extract <path>/patch-frFR.MPQ "Interface\AddOns\Blizzard_MyAddon\MyAddon.xml" -o ./originals
npm run mpq -- extract <path>/patch-frFR-2.MPQ "Interface\AddOns\Blizzard_MyAddon\MyAddon.toc" -o ./originals
npm run mpq -- extract <path>/locale-frFR.MPQ "Interface\AddOns\Blizzard_MyAddon\Localization.lua" -o ./originals

# 2. Copy to patch directory
mkdir -p my-patch/Interface/AddOns/Blizzard_MyAddon
cp originals/Interface/AddOns/Blizzard_MyAddon/* my-patch/Interface/AddOns/Blizzard_MyAddon/

# 3. Edit the TOC: remove "## Secure: 1"

# 4. Create empty TOC.SIG
echo -n "" > "my-patch/Interface/AddOns/Blizzard_MyAddon/BLIZZARD_MYADDON.TOC.SIG"

# 5. Edit the .lua file with your changes

# 6. Build and deploy
npm run mpq -- patch ./my-patch -o patch-4.MPQ
cp patch-4.MPQ /path/to/wow/Data/
```

### Finding Which MPQ Contains a File

Files can exist in multiple MPQs. The one loaded **last** is active. Always extract from the highest-priority patch:

```bash
# Search across all patches (check highest priority first)
npm run mpq -- list <path>/patch-3.MPQ | grep -i "MyAddon"
npm run mpq -- list <path>/frFR/patch-frFR-3.MPQ | grep -i "MyAddon"
npm run mpq -- list <path>/frFR/patch-frFR-2.MPQ | grep -i "MyAddon"
# ... and so on down the priority chain
```

## Locale-Independent vs Locale-Specific Patches

### When to use `Data/patch-X.MPQ` (base patch)

- Modifying game logic (Lua code) that is **not** locale-specific
- Overriding DBC files
- Overriding textures, models, sounds
- Works for **all** locales at once (as long as the suffix number is higher than existing locale patches)

### When to use `Data/{locale}/patch-{locale}-X.MPQ`

- Modifying locale-specific strings or translations
- When you need a patch that only applies to one language
- When targeting a file that only exists in locale MPQs and you can't use a higher base patch number

### Recommendation

Prefer a single `Data/patch-X.MPQ` with the next available number. This covers all locales and is simpler to maintain. Only use locale patches when you're modifying translations.

## Common File Locations Inside MPQs

| Path | Content |
|------|---------|
| `DBFilesClient\*.dbc` | Data files (spells, items, maps, etc.) |
| `Interface\AddOns\Blizzard_*\` | Blizzard UI addons |
| `Interface\FrameXML\` | Core UI framework (Lua + XML) |
| `Interface\GuildBankFrame\` | Guild bank UI textures |
| `Interface\Icons\` | Spell/item icons |
| `Interface\GLUES\` | Login screen assets |
| `World\Maps\` | Map/terrain data |
| `Sound\` | Audio files |

## Troubleshooting

### Patch not loading

- Verify the file is named `patch-{single_char}.MPQ` (e.g. `patch-4.MPQ`)
- Multi-character names like `patch-lordaeron.MPQ` are **not** recognized
- Make sure the file is in `Data/`, not a subdirectory (unless it's a locale patch)
- Restart the client — MPQs are only loaded at startup

### "Corrupted" error when opening UI

- You are overriding a Blizzard addon without neutralizing the signature
- Include the `.toc` without `## Secure: 1` and an empty `.TOC.SIG`
- See [Overriding Blizzard Addons](#overriding-blizzard-addons)

### Changes not visible / old version still active

- A higher-priority MPQ contains the same file and overrides yours
- Use `list` to check all patches for the file and verify load order
- Your patch number must be higher than all existing patches containing that file

### MPQ format version

- Always use **MPQ v1** for WoW 3.3.5a compatibility (max 4 GB per archive)
- mpq-builder uses v1 by default
