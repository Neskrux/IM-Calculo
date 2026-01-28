import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Evitar que window.confirm e alert quebrem nos testes
vi.stubGlobal('confirm', vi.fn())
vi.stubGlobal('alert', vi.fn())
