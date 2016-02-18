"format cjs";

var utils = require("./npm-utils");
exports.includeInBuild = true;

var isNode = typeof process === "object" && {}.toString.call(process) ===
	"[object process]";
var isWorker = typeof WorkerGlobalScope !== "undefined" && (self instanceof WorkerGlobalScope);
var isBrowser = typeof window !== "undefined" && !isNode && !isWorker;

exports.addExtension = function(System){
	if (System._extensions) {
		System._extensions.push(exports.addExtension);
	}
	/**
	 * Normalize has to deal with a "tricky" situation.  There are module names like
	 * "css" -> "css" normalize like normal
	 * "./qunit" //-> "qunit"  ... could go to steal-qunit#qunit, but then everything would?
	 *
	 * isRoot?
	 *   "can-slider" //-> "path/to/main"
	 *
	 * else
	 *
	 *   "can-slider" //-> "can-slider#path/to/main"
	 */
	var oldNormalize = System.normalize;
	System.normalize = function(name, parentName, parentAddress, pluginNormalize){
		if(parentName && this.npmParentMap[parentName]) {
			parentName = this.npmParentMap[parentName];
		}

		var hasNoParent = !parentName;
		var nameIsRelative = utils.path.isRelative(name);
		var parentIsNpmModule = utils.moduleName.isNpm(parentName);

		// If this is a relative module name and the parent is not an npm module
		// we can skip all of this logic.
		if(parentName && nameIsRelative && !parentIsNpmModule) {
			return oldNormalize.call(this, name, parentName, parentAddress,
									 pluginNormalize);
		}

		// Check against contextual maps that would not be converted.
		var hasContextualMap = typeof this.map[parentName] === "object" &&
		  this.map[parentName][name];
		if(hasContextualMap) {
			return oldNormalize.call(this, name, parentName, parentAddress,
									 pluginNormalize);
		}

		// Get the current package
		var refPkg = utils.pkg.findByModuleNameOrAddress(this, parentName,
														 parentAddress);

		// this isn't in a package, so ignore
		if(!refPkg) {
			return oldNormalize.call(this, name, parentName, parentAddress,
									 pluginNormalize);
		}

		// Using the current package, get info about what it is probably asking for
		var parsedModuleName = utils.moduleName.parseFromPackage(this, refPkg,
																 name, 
																 parentName);

		var isRoot = refPkg === this.npmPaths.__default;
		var parsedPackageNameIsReferringPackage =
			parsedModuleName.packageName === refPkg.name;

		// Are we normalizing a module that is relative to another npm module?
		var isRelativeToParentNpmModule =
			parentIsNpmModule &&
			nameIsRelative &&
			parsedPackageNameIsReferringPackage;


		// Look for the dependency package specified by the current package
		var depPkg, wantedPkg;

		// If we are within the same package then refPkg is the package we care
		// about
		if(isRelativeToParentNpmModule) {
			depPkg = refPkg;
		}

		var context = this.npmContext;
		var crawl = context && context.crawl;
		if(!depPkg) {
			if(crawl && !isRoot) {
				var parentPkg = nameIsRelative ? null :
					crawl.matchedVersion(context, refPkg.name, 
										 refPkg.version);
				if(parentPkg) {
					wantedPkg = crawl.getDependencyMap(this, parentPkg, isRoot)[parsedModuleName.packageName];
					if(wantedPkg) {
						var foundPkg = crawl.matchedVersion(this.npmContext,
															wantedPkg.name,
															wantedPkg.version);
						if(foundPkg) {
							depPkg = utils.pkg.findByUrl(this, foundPkg.fileUrl);
						}
					}
				}
			} else {

			//if(!depPkg) {
				depPkg = utils.pkg.findDep(this, refPkg, parsedModuleName.packageName);
			}
		}

		// This really shouldn't happen, but lets find a package.
		var lookupByName = parsedModuleName.isGlobal || hasNoParent ||
			parsedPackageNameIsReferringPackage;
		if (!depPkg) {
			depPkg = utils.pkg.findByName(this, parsedModuleName.packageName);
		}

		var isThePackageWeWant = !crawl || !depPkg ||
			(wantedPkg ? crawl.pkgSatisfies(depPkg, wantedPkg.version) : true);
		if(!isThePackageWeWant) {
			depPkg = undefined;
		}

		// It could be something like `fs` so check in globals
		if(!depPkg) {
			var browserPackageName = this.globalBrowser[parsedModuleName.packageName];
			if(browserPackageName) {
				parsedModuleName.packageName = browserPackageName;
				depPkg = utils.pkg.findByName(this, parsedModuleName.packageName);
			}
		}

		// It could be the root main.
		if(!depPkg && isRoot && name === refPkg.main &&
		  utils.pkg.hasDirectoriesLib(refPkg)) {
			parsedModuleName.version = refPkg.version;
			parsedModuleName.packageName = refPkg.name;
			parsedModuleName.modulePath = utils.pkg.main(refPkg);
			return oldNormalize.call(this,
									 utils.moduleName.create(parsedModuleName),
									 parentName, parentAddress, pluginNormalize);
		}

		// TODO Here is where we should progressively load the package.json files.
		var loader = this;
		if(!depPkg) {
			if(crawl) {
				var parentPkg = crawl.matchedVersion(this.npmContext, refPkg.name,
													 refPkg.version);
				if(parentPkg) {
					depPkg = crawl.getDependencyMap(this, parentPkg, isRoot)[parsedModuleName.packageName];
				}
			}

			if(!depPkg) {
				if(refPkg.browser && refPkg.browser[name]) {
					return oldNormalize.call(this, refPkg.browser[name], parentName,
											 parentAddress, pluginNormalize);
				}
				return oldNormalize.call(this, name, parentName, parentAddress,
										 pluginNormalize);
			}
			return crawl.dep(this.npmContext, parentPkg, depPkg, isRoot)
				.then(createModuleNameAndNormalize);
		} else {
			return createModuleNameAndNormalize(depPkg);
		}

		function createModuleNameAndNormalize(depPkg){
			parsedModuleName.version = depPkg.version;
			// add the main path
			if(!parsedModuleName.modulePath) {
				parsedModuleName.modulePath = utils.pkg.main(depPkg);
			}
			var moduleName = utils.moduleName.create(parsedModuleName);
			// Apply mappings, if they exist in the refPkg
			if(refPkg.system && refPkg.system.map &&
			   typeof refPkg.system.map[moduleName] === "string") {
				moduleName = refPkg.system.map[moduleName];
			}
			return oldNormalize.call(loader, moduleName, parentName,
									 parentAddress, pluginNormalize);

		}

		if(depPkg) {
			parsedModuleName.version = depPkg.version;
			// add the main path
			if(!parsedModuleName.modulePath) {
				parsedModuleName.modulePath = utils.pkg.main(depPkg);
			}
			var moduleName = utils.moduleName.create(parsedModuleName);
			// Apply mappings, if they exist in the refPkg
			if(refPkg.system && refPkg.system.map &&
			   typeof refPkg.system.map[moduleName] === "string") {
				moduleName = refPkg.system.map[moduleName];
			}
			return oldNormalize.call(this, moduleName, parentName,
									 parentAddress, pluginNormalize);
		} else {
			if(depPkg === this.npmPaths.__default) {
				// if the current package, we can't? have the
				// module name look like foo@bar#./zed
				var localName = parsedModuleName.modulePath ?
					parsedModuleName.modulePath+(parsedModuleName.plugin? parsedModuleName.plugin: "") :
					utils.pkg.main(depPkg);
				return oldNormalize.call(this, localName, parentName,
										 parentAddress, pluginNormalize);
			}
			if(refPkg.browser && refPkg.browser[name]) {
				return oldNormalize.call(this, refPkg.browser[name], parentName,
										 parentAddress, pluginNormalize);
			}
			return oldNormalize.call(this, name, parentName, parentAddress,
									 pluginNormalize);
		}
	};

	var oldLocate = System.locate;
	System.locate = function(load){
		var parsedModuleName = utils.moduleName.parse(load.name),
			loader = this;
		// @ is not the first character
		if(parsedModuleName.version && this.npm && !loader.paths[load.name]) {
			var pkg = this.npm[utils.moduleName.nameAndVersion(parsedModuleName)];
			if(pkg) {
				return oldLocate.call(this, load).then(function(address){
					var expectedAddress = utils.path.joinURIs(
						System.baseURL, load.name
					);
					if(isBrowser) {
						expectedAddress = expectedAddress.replace(/#/g, "%23");
					}

					// If locate didn't do the expected thing then we're going
					// to guess that we shouldn't perform NPM lookup on this
					// module as there might be a wildcard path.
					if(address !== expectedAddress + ".js" &&
					  address !== expectedAddress) {
						return address;
					}


					var root = utils.pkg.rootDir(pkg, pkg === loader.npmPaths.__default);

					if(parsedModuleName.modulePath) {
						var npmAddress = utils.path.joinURIs(
							utils.path.addEndingSlash(root),
								parsedModuleName.plugin ?
								parsedModuleName.modulePath :
								utils.path.addJS(parsedModuleName.modulePath)
						);
						return npmAddress;
					}

					return address;
				});
			}
		}
		return oldLocate.call(this, load);
	};

	var oldFetch = System.fetch;
	System.fetch = function(load){
		if(load.metadata.dryRun) {
			return oldFetch.apply(this, arguments);
		}

		var loader = this;
		return Promise.resolve(oldFetch.apply(this, arguments))
			.then(null, function(){
				var local = utils.extend({}, load);
				local.name = load.name + "/index";
				local.metadata = { dryRun: true };

				return Promise.resolve(loader.locate(local))
					.then(function(address){
						local.address = address;
						return loader.fetch(local);
					})
					.then(function(source){
						load.address = local.address;
						loader.npmParentMap[load.name] = local.name;
						var npmLoad = loader.npmContext && 
							loader.npmContext.npmLoad;
						if(npmLoad) {
							npmLoad.saveLoadIfNeeded(loader.npmContext);
						}
						return source;
					});
			});
	};

	// Given a moduleName convert it into a npm-style moduleName if it belongs
	// to a package.
	var convertName = function(loader, name){
		var pkg = utils.pkg.findByName(loader, name.split("/")[0]);
		if(pkg) {
			var parsed = utils.moduleName.parse(name, pkg.name);
			parsed.version = pkg.version;
			if(!parsed.modulePath) {
				parsed.modulePath = utils.pkg.main(pkg);
			}
			return utils.moduleName.create(parsed);
		}
		return name;
	};

	var configSpecial = {
		map: function(map){
			var newMap = {}, val;
			for(var name in map) {
				val = map[name];
				newMap[convertName(this, name)] = typeof val === "object"
					? configSpecial.map(val)
					: convertName(this, val);
			}
			return newMap;
		},
		meta: function(map){
			var newMap = {};
			for(var name in map){
				newMap[convertName(this, name)] = map[name];
			}
			return newMap;
		},
		paths: function(paths){
			var newPaths = {};
			for(var name in paths) {
				newPaths[convertName(this, name)] = paths[name];
			}
			return newPaths;
		}
	};


	var oldConfig = System.config;
	System.config = function(cfg){
		var loader = this;
		for(var name in cfg) {
			if(configSpecial[name]) {
				cfg[name] = configSpecial[name].call(loader, cfg[name]);
			}
		}
		oldConfig.apply(loader, arguments);
	};
};
