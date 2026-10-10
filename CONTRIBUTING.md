# Contributing to AgapSense

Thank you for your interest in contributing to the AgapSense project! Your contributions help improve the system and make it more robust.

## How to Contribute

1. **Fork the Repository:** Create your own fork of the AgapSense repository.
2. **Clone the Repository:** Clone your fork locally to begin making changes.
3. **Create a Branch:** Create a feature branch for your work. Use a descriptive name like `feature/new-alert-type` or `fix/login-lockout-bug`.
4. **Make Changes:** Write your code, update documentation, and ensure everything is working correctly.
5. **Test Your Changes:** Run the project locally, verify the behavior in your browser, and confirm that edge cases are handled. Follow the live-testing methodologies detailed in the `testing/` directory.
6. **Submit a Pull Request (PR):** Open a PR against the main branch of the original repository. Provide a clear and detailed description of the changes you made, why you made them, and how they can be tested.

## Coding Standards

### Frontend (React / TypeScript)
- Use functional components and React hooks.
- Write strict TypeScript code; avoid `any` wherever possible.
- Use TailwindCSS for styling.
- Ensure components are accessible and follow responsive design principles.
- Use `oxlint` for linting (`npm run lint`). Fix any linting errors before committing.

### Backend (Supabase Edge Functions / Deno)
- Write modular and reusable code.
- Ensure Edge Functions are secure and validate inputs properly.
- Use Environment Variables (`Deno.env.get`) for configuration and secrets.
- Handle errors gracefully and return meaningful HTTP status codes.

### Database (PostgreSQL)
- Write clear and documented SQL migrations.
- Always use Row Level Security (RLS) policies to protect data.
- Ensure functions (RPCs) are secure and use `security definer` only when absolutely necessary, properly checking user roles and permissions within the function body.
- Name migrations sequentially with a timestamp prefix (e.g., `YYYYMMDDHHMMSS_description.sql`).

### Firmware (C++ / PlatformIO)
- Organize code into logical modules (`sensors.cpp`, `connectivity.cpp`, etc.).
- Use FreeRTOS tasks to manage concurrent operations efficiently.
- Do not check in sensitive configuration files (`config.h`); use `config.example.h` as a template.
- Utilize `TelnetStream` for debugging when `DEBUG_MODE` is enabled.

## Code Review Process

- All PRs will be reviewed by the maintainers.
- Be prepared to discuss your code and make changes based on feedback.
- Ensure your code is thoroughly documented, both inline and in relevant Markdown files, reflecting the current state of the code.

## Documentation

- Documentation is kept in Markdown files, particularly within the `docs/` and `testing/` directories.
- If you add a new feature, update the relevant documentation. If you modify a database schema or Edge Function, ensure `docs/FEATURES.md` and `docs/MIGRATION_GUIDE.md` are kept up-to-date.

We appreciate your contributions to making AgapSense better!
