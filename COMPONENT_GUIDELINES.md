# Component guidelines

1. Use a primitive from `components/ui` before writing markup. Add a new primitive only when two pages need it.
2. Colours and fonts come from tokens. Use Tailwind token classes (`bg-s2`, `text-t2`, `border-line`) or `var(--token)`. No literal colours in UI code. Caption styles are the exception: they are user data.
3. Every interactive element has an accessible name, a visible focus state and a hover state. Icon-only buttons take `aria-label` and a `Tip`.
4. Destructive actions use `ConfirmDialog` and say what is lost and that it cannot be undone.
5. Forms: label above, error below with `role="alert"`, `aria-invalid` on the field. Validate on submit and clear the error on edit.
6. Every list or grid has a loading state (Skeleton), an empty state that tells the user what to do, and a filtered-empty state with a clear-filters action.
7. Anything simulated says so: a "Simulated" badge, "Sample" wording, or a toast. Never imply a real file was written or analysed.
8. Pages stay thin. Logic that two pages share goes in a store or hook. Keep files under about 300 lines when practical.
9. No `transition: all`. Animate transform and opacity only.
10. Components that change at frame rate subscribe to the playhead store as leaves. Do not read `time` in a page component.
11. Naming: components `PascalCase`, hooks `useThing`, stores `useThing`, services expose a typed interface.
