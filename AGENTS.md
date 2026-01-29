# AGENTS.MD - Electron Incremental Update Development Guidelines

## Build/Lint/Test Commands

### Primary Commands
```bash
# Build the project
bun run build

# Development mode (watch)
bun run dev

# Run all tests
bun run test

# Run tests in watch mode
bun run test:dev

# Run a single test file (replace path as needed)
bun test tests/crypto.test.ts

# Run specific test pattern
bun test --pattern="crypto"

# Comprehensive QA check (lint, format, type check)
bun run qa

# Release workflow (format, lint, test, build, bump versions)
bun run release
```

## Code Style Guidelines

### Imports
- Use bare imports for package exports (e.g., `import { createElectronApp } from 'electron-incremental-update'`)
- Use relative imports for internal modules (e.g., `import { hashBuffer } from '../utils/crypto'`)
- Group imports: external packages first, then internal modules
- Use type imports where appropriate: `import type { SomeType } from './types'`
- Prefer named exports and imports over default exports

### Formatting
- No semicolons (semi: false)
- Single quotes for strings
- Sort imports automatically using formatter
- Use consistent indentation (2 spaces)
- Follow Prettier-compatible formatting rules

### TypeScript Guidelines
- Use strict TypeScript typing throughout
- Prefer type-safe imports: `typescript/consistent-type-imports`
- Use `typescript/consistent-type-definitions` (prefer interfaces over types when possible)
- Avoid `var` declarations (`no-var` rule enforced)
- Use `const` and `let` appropriately
- Type all function parameters and return values
- Use discriminated unions when applicable

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for classes and types
- Use UPPER_SNAKE_CASE for constants
- Method names should be verb phrases (e.g., `checkForUpdates`, `quitAndInstall`)
- Event handler properties prefixed with `on` (e.g., `onDownloading`, `onUpdateAvailable`)

### Error Handling
- Use try/catch blocks for async operations
- Implement proper error events (updater.on('error', ...))
- Log errors with appropriate context
- Fail gracefully when possible
- Use specific error types where available
- Avoid silent failures

### Testing Guidelines
- Use Bun test runner for all tests
- Follow BDD-style testing with describe/it blocks
- Name test files with `.test.ts` suffix
- Test edge cases and error conditions
- Mock external dependencies appropriately
- Use async/await for asynchronous tests
- Clean up resources in afterAll/beforeAll hooks

### Performance Considerations
- Minimize dependencies in the final bundle
- Use lazy loading where appropriate
- Efficient memory management for large files
- Proper cleanup of event listeners
- Optimize file I/O operations

### Documentation
- Use JSDoc for exported functions/classes
- Document all public API methods
- Include examples where complex usage exists
- Keep README up to date with major changes
- Comment complex algorithms thoroughly
