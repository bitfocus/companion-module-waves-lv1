import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

const customConfig = [
	...baseConfig,
	{
		files: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.mjs'],
	},
	{
		// tsconfig.json allows .ts imports (for the tests), which turns off eslint-plugin-n's own
		// .js -> .ts mapping: give it back.
		settings: {
			n: {
				typescriptExtensionMap: [
					['', '.js'],
					['.ts', '.js'],
					['.cts', '.cjs'],
					['.mts', '.mjs'],
				],
			},
		},
	},
	{
		rules: {
			'no-use-before-define': 'off',
			'@typescript-eslint/no-use-before-define': 'off',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
]

export default customConfig
