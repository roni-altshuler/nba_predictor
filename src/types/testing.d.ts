/**
 * Pulls @testing-library/jest-dom's matcher types into the project.
 *
 * Without this, `expect(...).toBeInTheDocument()` type-checks as an error
 * even though the matcher IS registered at runtime by jest.setup.js — so
 * `npm test` passes and `tsc --noEmit` fails. That is the worst combination
 * available, because CI runs both and the failure looks like a broken test
 * rather than a missing type reference.
 */
import '@testing-library/jest-dom'
