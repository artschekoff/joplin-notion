module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	testMatch: ['**/__tests__/**/*.test.ts'],
	moduleNameMapper: {
		'^api$': '<rootDir>/api/index.ts',
		'^api/(.*)$': '<rootDir>/api/$1',
	},
	// pdfjs-dist v4 is ESM-only; allow Jest to transform it instead of
	// leaving it as raw ESM which CJS Jest cannot execute.
	transformIgnorePatterns: ['/node_modules/(?!(pdfjs-dist)/)'],
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
		'^.+\\.mjs$': ['ts-jest', { diagnostics: false }],
	},
};
