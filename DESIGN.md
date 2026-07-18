# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-10
- Primary product surfaces: web card trainer, Android WebView wrapper
- Evidence reviewed: README.md, web/index.html, web/styles.css, web/app.js

## Brand
- Personality: focused, quiet, study-first
- Trust signals: stable card interactions, clear JLPT level labels, visible progress and error history
- Avoid: marketing-style hero layouts, decorative effects that reduce scan speed

## Product goals
- Goals: help Korean learners memorize JLPT N5-N1 kanji vocabulary through fast recall loops
- Non-goals: dictionary replacement, grammar instruction, social learning
- Success signals: quick card review, clear answer verification, visible weak-word prioritization, progress that advances only after recall succeeds

## Personas and jobs
- Primary personas: Korean learners preparing for JLPT vocabulary recall
- User jobs: review new words, verify known words, focus on high-error vocabulary
- Key contexts of use: mobile portrait sessions, desktop browser checks, Android WebView

## Information architecture
- Primary navigation: bottom tabs for study, error-rate review, and settings
- Core routes/screens: card study surface, cumulative wrong-rate list, compact daily study settings
- Content hierarchy: current card first, answer controls next, fixed session stats directly above safe-area-aligned bottom navigation, settings on their own tab, cumulative review on its own tab with local JLPT level filters

## Design principles
- Principle 1: put recall content before controls on narrow portrait screens
- Principle 2: keep repeated study controls dense and predictable
- Tradeoffs: cumulative history may show words excluded from future sessions if they were already presented

## Visual language
- Color: restrained light interface with blue actions, green correct states, red wrong states
- Typography: Japanese serif for target words, Korean/Japanese sans-serif for controls and metadata
- Spacing/layout rhythm: compact panels with 8px radii and consistent 10-18px gaps
- Shape/radius/elevation: cards and panels use 8px radius; only primary card carries strong shadow
- Motion: short card transform transitions only
- Imagery/iconography: no decorative imagery needed for this utilitarian trainer

## Components
- Existing components to reuse: segmented controls, primary/text buttons, number fields, study card, stats rows
- New/changed components: bottom tab navigation, fixed study stats rail, settings panel, wrong-rate level filter, wrong-rate list item, wrong-rate empty state
- Variants and states: active tab, active/inactive level filters, empty filtered wrong-rate history, responsive compact list item
- Token/component ownership: CSS custom properties in web/styles.css

## Accessibility
- Target standard: semantic controls with keyboard-friendly native buttons
- Keyboard/focus behavior: tabs are buttons; card supports arrow and Enter actions
- Contrast/readability: red/green states backed by text labels and soft backgrounds
- Screen-reader semantics: tablist/tabpanel roles are used for major view switching
- Reduced motion and sensory considerations: motion is minimal and short

## Responsive behavior
- Supported breakpoints/devices: desktop, tablet, mobile portrait
- Layout adaptations: portrait study keeps navigation flush with the bottom safe edge, pins session stats directly above it, divides the remaining study area between card and answer controls at 4:1, and moves settings to a separate tab; mobile wrong-rate rows wrap rate below word metadata and stay clear of the bottom tabs
- Touch/hover differences: answer buttons are primary on touch screens; card taps confirm or advance after reveal

## Interaction states
- Loading: static local app, no remote loading state
- Empty: card and wrong-rate list show empty states
- Error: local storage failures degrade to current-session use
- Success: answer verification panel and correct/wrong glow states; wrong cards re-enter the current session queue until answered correctly without adding another global seen/correct count
- Disabled: level deselection prevents removing the final selected level
- Offline/slow network, if applicable: service worker caches static assets

## Content voice
- Tone: direct Korean study-tool labels
- Terminology: use JLPT level, 급수, 오답률, 제시, 정답, 오답, 평균 고민, 하루 학습량, 새롭게 제시되는 단어의 비율 consistently
- Microcopy rules: keep labels short; avoid explaining gestures in long prose

## Implementation constraints
- Framework/styling system: static HTML/CSS/vanilla JS
- Design-token constraints: use existing CSS variables
- Performance constraints: render wrong-rate list from local progress only
- Compatibility constraints: must work in Android WebView and local HTTP server
- Test/screenshot expectations: verify syntax, local served assets, and data sort behavior

## Open questions
- [ ] Whether wrong-rate review should later support search by term / owner: product / impact: long-list scan speed
