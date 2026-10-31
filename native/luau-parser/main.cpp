#include "Luau/Allocator.h"
#include "Luau/Ast.h"
#include "Luau/AstJsonEncoder.h"
#include "Luau/ParseOptions.h"
#include "Luau/Parser.h"
#include "json.hpp"
#include <iostream>
#include <string>
#include <unordered_map>
LUAU_FASTFLAGVARIABLE(LuauExperimentalIfLocalAnalysis)
using nlohmann::json;
static size_t utf8Length(const std::string &s, size_t i) {
  unsigned char c = s[i];
  if (c < 128)
    return 1;
  size_t n = c >= 0xc2 && c <= 0xdf   ? 2
             : c >= 0xe0 && c <= 0xef ? 3
             : c >= 0xf0 && c <= 0xf4 ? 4
                                      : 0;
  if (!n || i + n > s.size())
    return 0;
  unsigned value = c & ((1 << (7 - n)) - 1);
  for (size_t k = 1; k < n; k++) {
    unsigned char d = s[i + k];
    if ((d & 192) != 128)
      return 0;
    value = (value << 6) | (d & 63);
  }
  if (value < (n == 2   ? 128
               : n == 3 ? 2048
                        : 65536) ||
      value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
    return 0;
  return n;
}
static std::string safeJson(const std::string &text) {
  std::string out;
  out.reserve(text.size());
  bool quoted = false, escaped = false;
  const char *hex = "0123456789abcdef";
  for (size_t i = 0; i < text.size();) {
    char c = text[i];
    if (quoted) {
      if (escaped) {
        out += c;
        escaped = false;
        i++;
        continue;
      }
      if (c == '\\') {
        out += c;
        escaped = true;
        i++;
        continue;
      }
      if (c == '"') {
        quoted = false;
        out += c;
        i++;
        continue;
      }
      const auto n = utf8Length(text, i);
      if (n) {
        out.append(text, i, n);
        i += n;
      } else {
        const auto b = static_cast<unsigned char>(c);
        out += "\\u00";
        out += hex[b >> 4];
        out += hex[b & 15];
        i++;
      }
      continue;
    }
    if (c == '"') {
      quoted = true;
      out += c;
      i++;
      continue;
    }
    bool special = false;
    for (const auto &token : {std::string("-Infinity"), std::string("Infinity"),
                              std::string("NaN")})
      if (text.compare(i, token.size(), token) == 0) {
        out += json({{"nonFinite", token}}).dump();
        i += token.size();
        special = true;
        break;
      }
    if (!special) {
      out += c;
      i++;
    }
  }
  return out;
}
struct BinaryStrings : Luau::AstVisitor {
  std::unordered_map<std::string, json> values;
  bool visit(Luau::AstExprConstantString *node) override {
    const std::string bytes(node->value.data, node->value.size);
    bool valid = true;
    for (size_t i = 0; i < bytes.size();) {
      auto n = utf8Length(bytes, i);
      if (!n) {
        valid = false;
        break;
      }
      i += n;
    }
    if (!valid) {
      std::string hex;
      const char *digits = "0123456789abcdef";
      for (unsigned char c : bytes) {
        hex += digits[c >> 4];
        hex += digits[c & 15];
      }
      const auto &p = node->location;
      const auto key = std::to_string(p.begin.line) + "," +
                       std::to_string(p.begin.column) + " - " +
                       std::to_string(p.end.line) + "," +
                       std::to_string(p.end.column);
      values[key] = {{"bytesHex", hex}, {"encoding", "luau-bytes"}};
    }
    return true;
  }
};
static void restoreBinary(json &value, const BinaryStrings &strings) {
  if (value.is_object()) {
    if (value.value("type", "") == "AstExprConstantString") {
      const auto it = strings.values.find(value.value("location", ""));
      if (it != strings.values.end())
        value["value"] = it->second;
    }
    for (auto &entry : value.items())
      restoreBinary(entry.value(), strings);
  } else if (value.is_array())
    for (auto &entry : value)
      restoreBinary(entry, strings);
}
int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    try {
      auto request = json::parse(line);
      if (request.value("protocolVersion", 0) != 1)
        throw std::runtime_error("Unsupported protocol");
      auto source = request.at("text").get<std::string>();
      if (source.size() > 16 * 1024 * 1024)
        throw std::runtime_error("SCRIPT_SIZE_LIMIT");
      Luau::Allocator allocator;
      Luau::AstNameTable names(allocator);
      Luau::ParseOptions options;
      options.captureComments = true;
      options.allowDeclarationSyntax = false;
      auto result = Luau::Parser::parse(source.data(), source.size(), names,
                                        allocator, options);
      json diagnostics = json::array();
      for (const auto &e : result.errors)
        diagnostics.push_back({{"code", "LUAU_PARSE_ERROR"},
                               {"severity", "warning"},
                               {"message", e.getMessage()}});
      json ast = nullptr;
      if (result.root && result.errors.empty()) {
        BinaryStrings strings;
        result.root->visit(&strings);
        ast = json::parse(safeJson(Luau::toJson(result.root)));
        restoreBinary(ast, strings);
      }
      std::cout << json({{"ast", ast},
                         {"diagnostics", diagnostics},
                         {"parserVersion",
                          "a4818b6678822bb726a0eb2299cae751d3017a6a"}})
                       .dump()
                << std::endl;
    } catch (const std::exception &e) {
      std::cout << json({{"error", e.what()}}).dump() << std::endl;
    }
  }
}
