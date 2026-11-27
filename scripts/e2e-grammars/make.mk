# Build and test the review module.
PROFILE ?= release
OUT := pkg
SOURCES := $(wildcard src/*.rs)

.PHONY: all test clean

all: $(OUT)/review_wasm_bg.wasm

$(OUT)/review_wasm_bg.wasm: $(SOURCES) Cargo.toml
	cargo build --profile $(PROFILE) --target wasm32-unknown-unknown
	@echo "built $@ from $(words $(SOURCES)) sources"

test:
	cargo test --workspace -- --nocapture

clean:
	rm -rf $(OUT) target
