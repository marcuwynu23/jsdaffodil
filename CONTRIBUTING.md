# 🤝 Contributing to JSDaffodil

Welcome to the JSDaffodil contribution guide! This document outlines how to contribute, collaborate, and work effectively with the JSDaffodil project.

## 📚 Documentation Overview

This project includes comprehensive documentation to help you get started:

- **[GUIDELINES.md](./GUIDELINES.md)** - **Complete usage guide** with comprehensive examples, best practices, troubleshooting, and real-world scenarios. Includes sample code from the `src/samples/` directory.
- **[DOCUMENTATION.md](./DOCUMENTATION.md)** - **Developer documentation** for contributing, extending, and developing the project. Covers architecture, code organization, testing, and extension points.
- **[README.md](./README.md)** - Quick start and overview for end users

## 🎯 Getting Started

Before contributing, please:

1. **Read the Documentation**
   - Start with [GUIDELINES.md](./GUIDELINES.md) to understand how to use JSDaffodil
   - Review [DOCUMENTATION.md](./DOCUMENTATION.md) for development setup and architecture
   - Check [README.md](./README.md) for quick reference

2. **Explore the Codebase**
   - Check the `src/samples/` directory for usage examples
   - Review `src/index.js` for the main implementation
   - Understand the project structure

3. **Set Up Your Environment**
   - Install dependencies: `npm install`
   - Run tests: `npm test`
   - Review the development setup in [DOCUMENTATION.md](./DOCUMENTATION.md)

## 🔄 Contribution Workflow

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/jsdaffodil.git
cd jsdaffodil
```

### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 3. Make Changes

- Follow the coding standards outlined in [DOCUMENTATION.md](./DOCUMENTATION.md)
- Write tests for new features
- Update documentation as needed
- Ensure all tests pass: `npm test`
- Format code: `npm run format` (if configured)

### 4. Commit Changes

Use clear, descriptive commit messages following [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat: add verbose logging option"
git commit -m "fix: resolve baseDir initialization issue"
git commit -m "docs: update usage examples"
git commit -m "test: add tests for error handling"
```

**Commit Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear description of changes
- Reference to related issues
- Screenshots/examples if applicable
- Updated CHANGELOG.md entry

## 📋 Code Review Guidelines

### For Contributors

- Keep PRs focused and small when possible
- Write clear commit messages
- Add tests for new features
- Update documentation
- Respond to review feedback promptly
- Ensure all CI checks pass

### For Reviewers

- Be constructive and respectful
- Test the changes locally
- Check code quality and style
- Verify tests pass
- Ensure documentation is updated

## 🐛 Reporting Issues

When reporting issues, please include:

1. **Description** - Clear explanation of the issue
2. **Steps to Reproduce** - Detailed steps to reproduce
3. **Expected Behavior** - What should happen
4. **Actual Behavior** - What actually happens
5. **Environment** - Node.js version, OS, etc.
6. **Code Example** - Minimal code that reproduces the issue
7. **Error Messages** - Full error output (with verbose mode if applicable)

## 💡 Feature Requests

For feature requests:

1. Check if the feature already exists or is planned
2. Open an issue with the `enhancement` label
3. Describe the use case and benefits
4. Provide examples if possible

## 🧪 Testing

Before submitting PRs:

```bash
# Run all tests
npm test

# Run ESM tests only
npm run test:esm

# Run CommonJS tests only
npm run test:common
```

Ensure all tests pass and add tests for new features.

## 📝 Documentation

When contributing:

- Update relevant documentation files
- Add examples for new features
- Keep code comments clear and helpful
- Update [CHANGELOG.md](./CHANGELOG.md) with your changes

## 🎨 Code Style

- Follow existing code style
- Use meaningful variable names
- Add JSDoc comments for public methods
- Keep functions focused and small
- Handle errors appropriately
- Follow the `.editorconfig` and `.prettierrc` settings

## 🔐 Security

- Never commit sensitive information (SSH keys, passwords, etc.)
- Report security vulnerabilities privately to the maintainers
- Follow security best practices
- Review dependencies regularly

## 📞 Communication

- Use GitHub Issues for bug reports and feature requests
- Use GitHub Discussions for questions and ideas
- Be respectful and constructive in all communications
- Help others learn and contribute

## 🏆 Recognition

Contributors will be:
- Listed in the project README (if desired)
- Credited in release notes
- Appreciated by the community!

## 📖 Additional Resources

- **Usage Guide**: See [GUIDELINES.md](./GUIDELINES.md) for comprehensive usage examples, best practices, and troubleshooting. The guide includes sample code from the `src/samples/` directory.
- **Developer Guide**: See [DOCUMENTATION.md](./DOCUMENTATION.md) for complete architecture documentation, development setup, code organization, testing guidelines, and extension points.
- **Examples**: Check the `src/samples/` directory for working examples:
  - `src/samples/sample.mjs` - ESM module example
  - `src/samples/sample.cjs` - CommonJS module example

## ❓ Questions?

If you have questions:

1. Check the documentation files first
2. Review existing issues and discussions
3. Open a new issue with the `question` label
4. Be patient and respectful

---

Thank you for contributing to JSDaffodil! 🌼

