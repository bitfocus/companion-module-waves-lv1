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
