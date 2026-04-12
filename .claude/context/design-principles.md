# S-Tier SaaS Dashboard Design Checklist (Inspired by Stripe, Airbnb, Linear)

## I. Core Design Philosophy & Strategy
*   [ ] **Users First:** Prioritize user needs, workflows, and ease of use in every design decision.
*   [ ] **Meticulous Craft:** Aim for precision, polish, and high quality in every UI element and interaction.
*   [ ] **Speed & Performance:** Design for fast load times and snappy, responsive interactions.
*   [ ] **Simplicity & Clarity:** Strive for a clean, uncluttered interface. Ensure labels, instructions, and information are unambiguous.
*   [ ] **Focus & Efficiency:** Help users achieve their goals quickly and with minimal friction. Minimize unnecessary steps or distractions.
*   [ ] **Consistency:** Maintain a uniform design language (colors, typography, components, patterns) across the entire dashboard.
*   [ ] **Accessibility (WCAG AA+):** Design for inclusivity. Ensure sufficient color contrast, keyboard navigability, and screen reader compatibility.
*   [ ] **Opinionated Design (Thoughtful Defaults):** Establish clear, efficient default workflows and settings, reducing decision fatigue for users.

## II. Design System Foundation (Tokens & Core Components)
*   [ ] **Define a Color Palette:**
    *   [ ] **Primary Brand Color:** User-specified, used strategically.
    *   [ ] **Neutrals:** A scale of grays (5-7 steps) for text, backgrounds, borders.
    *   [ ] **Semantic Colors:** Define specific colors for Success (green), Error/Destructive (red), Warning (yellow/amber), Informational (blue).
    *   [ ] **Dark Mode Palette:** Create a corresponding accessible dark mode palette.
    *   [ ] **Accessibility Check:** Ensure all color combinations meet WCAG AA contrast ratios.
*   [ ] **Establish a Typographic Scale:**
    *   [ ] **Primary Font Family:** Choose a clean, legible sans-serif font (e.g., Inter, Manrope, system-ui).
    *   [ ] **Modular Scale:** Define distinct sizes for H1, H2, H3, H4, Body Large, Body Medium (Default), Body Small/Caption.
    *   [ ] **Font Weights:** Utilize a limited set of weights (e.g., Regular, Medium, SemiBold, Bold).
    *   [ ] **Line Height:** Ensure generous line height for readability (e.g., 1.5-1.7 for body text).
*   [ ] **Define Spacing Units:**
    *   [ ] **Base Unit:** Establish a base unit (e.g., 8px).
    *   [ ] **Spacing Scale:** Use multiples of the base unit for all padding, margins, and layout spacing.
*   [ ] **Define Border Radii:**
    *   [ ] **Consistent Values:** Use a small set of consistent border radii.
*   [ ] **Develop Core UI Components (with consistent states: default, hover, active, focus, disabled):**
    *   [ ] Buttons (primary, secondary, tertiary/ghost, destructive, link-style)
    *   [ ] Input Fields (text, textarea, select, date picker)
    *   [ ] Checkboxes & Radio Buttons
    *   [ ] Toggles/Switches
    *   [ ] Cards
    *   [ ] Tables
    *   [ ] Modals/Dialogs
    *   [ ] Navigation Elements (Sidebar, Tabs)
    *   [ ] Badges/Tags
    *   [ ] Tooltips
    *   [ ] Progress Indicators
    *   [ ] Icons
    *   [ ] Avatars

## III. Layout, Visual Hierarchy & Structure
*   [ ] **Responsive Grid System:** Design based on a responsive grid for consistent layout across devices.
*   [ ] **Strategic White Space:** Use ample negative space to improve clarity and reduce cognitive load.
*   [ ] **Clear Visual Hierarchy:** Guide the user's eye using typography, spacing, and element positioning.
*   [ ] **Consistent Alignment:** Maintain consistent alignment of elements.
*   [ ] **RTL Support:** All layouts must work correctly in RTL (right-to-left) for Hebrew.
*   [ ] **Mobile-First Considerations:** Ensure the design adapts gracefully to smaller screens (390px minimum).

## IV. Interaction Design & Animations
*   [ ] **Purposeful Micro-interactions:** Use subtle animations and visual feedback for user actions.
    *   [ ] Feedback should be immediate and clear.
    *   [ ] Animations should be quick (150-300ms) and use appropriate easing.
*   [ ] **Loading States:** Implement clear loading indicators (skeleton screens, spinners).
*   [ ] **Transitions:** Use smooth transitions for state changes and modal appearances.
*   [ ] **Keyboard Navigation:** Ensure all interactive elements are keyboard accessible.

## V. Project-Specific Standards (Nutrition CRM)
*   [ ] **Brand Colors:** #fcf4f9 (bg), #F5DBEA (pink), #567DBF (blue), #31B996 (green)
*   [ ] **RTL:** dir="rtl" on all pages, Hebrew text throughout
*   [ ] **No gender slash-forms:** Never use אשר/י, בחר/י etc.
*   [ ] **Mobile:** Every screen must work at 390px width
*   [ ] **No emojis in WhatsApp templates**

## VI. CSS & Styling Architecture
*   [ ] **Utility-First:** Tailwind CSS with design tokens in config.
*   [ ] **Maintainability:** Code well-organized and easy to understand.
*   [ ] **Performance:** Optimize CSS delivery; avoid unnecessary bloat.

## VII. General Best Practices
*   [ ] **Iterative Design & Testing:** Continuously test and iterate.
*   [ ] **Clear Information Architecture:** Organize content and navigation logically.
*   [ ] **Responsive Design:** Fully functional on all device sizes.
*   [ ] **Documentation:** Maintain clear documentation for design system.
