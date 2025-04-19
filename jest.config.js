module.exports = {
    preset: 'ts-jest', // Use ts-jest preset
    testEnvironment: 'node', // Use Node.js environment
    testMatch: ['**/__tests__/**/*.test.ts'], // Match test files in the __tests__ folder
    moduleFileExtensions: ['ts', 'js', 'json'], // Supported file extensions
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json', // Use the existing TypeScript configuration
        }],
    },
    verbose: true, // Enable verbose mode
};
