#include <iostream>
#include <string>
#include "json.hpp"
#include "Luau/Allocator.h"
#include "Luau/Ast.h"
#include "Luau/AstJsonEncoder.h"
#include "Luau/Parser.h"
#include "Luau/ParseOptions.h"
LUAU_FASTFLAGVARIABLE(LuauExperimentalIfLocalAnalysis)
using nlohmann::json;
int main(){std::string line;while(std::getline(std::cin,line)){try{
 auto request=json::parse(line);if(request.value("protocolVersion",0)!=1)throw std::runtime_error("Unsupported protocol");
 auto source=request.at("text").get<std::string>();if(source.size()>16*1024*1024)throw std::runtime_error("SCRIPT_SIZE_LIMIT");
 Luau::Allocator allocator;Luau::AstNameTable names(allocator);Luau::ParseOptions options;options.captureComments=true;options.allowDeclarationSyntax=false;
 auto result=Luau::Parser::parse(source.data(),source.size(),names,allocator,options);
 json diagnostics=json::array();for(const auto& e:result.errors)diagnostics.push_back({{"code","LUAU_PARSE_ERROR"},{"severity","warning"},{"message",e.getMessage()}});
 json ast=nullptr;if(result.root && result.errors.empty())ast=json::parse(Luau::toJson(result.root));
 std::cout<<json({{"ast",ast},{"diagnostics",diagnostics},{"parserVersion","a4818b6678822bb726a0eb2299cae751d3017a6a"}}).dump()<<std::endl;
 }catch(const std::exception& e){std::cout<<json({{"error",e.what()}}).dump()<<std::endl;}}}
